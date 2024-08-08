//
//  browser/browser.ts ~ RL
//
//  Browser backend for Wordle Coop
//

import { CoopClient, CoopSeedablePRNG } from "../coop.js";
import { WordleCharacter, WordleCharacterState } from "../wordle.js";
import { WordListManager } from "../wordList.js";
import { BrowserGameState, BrowserShortcut, BrowserState, BrowserWaitingState } from "./browserAuxiliary.js";

export class BrowserSingleplayerState extends BrowserGameState {
    public constructor() {
        super("Singleplayer");
    }

    protected onPushWord(): void {
        const start = this.game.board.currentWordIndex;
        this.game.onPushWord();
        this.board.setWord(start, this.game.board.data[start].word);
    }

    protected onPushCharacter(key: string): void {
        const charPos = this.game.board.currentCharacterIndex;
        if (this.game.onPushCharacter(key))
            this.board.setCharacter(this.game.board.currentWordIndex, charPos, key);
    }

    protected onPopCharacter(): void {
        this.game.onPopCharacter();
        this.board.setCharacter(this.game.board.currentWordIndex, this.game.board.currentCharacterIndex, ' ');
    }

    protected tryStartNewGame(): void {
        if (this.game.startQueuedGame())
            this.createInterface();
    }

    protected shortcut(shortcut: BrowserShortcut) {
        switch (shortcut) {
            case BrowserShortcut.ToggleGuidedMode:
                this.game.guidedMode = !this.game.guidedMode;
                break;

            case BrowserShortcut.SetWordManual:
                const word = prompt("Word:", WordListManager.getRandomWord());
                if (word && WordListManager.getWordCoordinates(word)) {
                    this.game.restart(word);
                    this.createInterface();
                }
                else
                    alert("Word \"" + word + "\" not found.");
                break;

            case BrowserShortcut.SetWordNumber:
                const numberString = prompt("Word number:", Math.floor(Math.random() * WordListManager.getTotalWordCount()).toString());
                if (!numberString)
                    break;
                let number = parseInt(numberString);
                this.game.restart(WordListManager.getWordOnIndex(number));
                this.createInterface();
                break;

            case BrowserShortcut.GiveUp:
                const targetChars = [];
                for (let i = 0; i < this.game.board.targetWord.length; i++)
                    targetChars.push(new WordleCharacter(this.game.board.targetWord[i].toUpperCase(), WordleCharacterState.Green));
                this.board.setWord(this.game.board.currentWordIndex, targetChars);
                this.game.giveUp();
                break;

            case BrowserShortcut.Singleplayer:
                this.nextState = new BrowserSingleplayerState();
                break;

            case BrowserShortcut.HostGame:
                CoopClient.host().then(i => {
                    this.nextState = new BrowserWaitingState(i.whenReady().then(j => new BrowserCoopState(j)), this);
                    prompt("Session id:", i.sessionId);
                });
                break;

            case BrowserShortcut.JoinGame:
                const sessionId = prompt("Session id:");
                if (sessionId)
                    CoopClient.join(sessionId).then(i => this.nextState = new BrowserWaitingState(i.whenReady().then(j => new BrowserCoopState(j)), this));
                break;
        }
    }
}

export class BrowserCoopState extends BrowserGameState {
    private _connection: CoopClient;
    private _queuedWord: string | undefined;
    private _rng: CoopSeedablePRNG;
    /**
     * The amount of words pushed in total +1 or +0 depending on who sent the higher seed in DetermineStart.
     */
    private _wordState: number = 0;

    private onClose(): void {
        alert("Connection closed, moving to a singleplayer state.");
        this.nextState = new BrowserSingleplayerState();
    }

    public constructor(connection: CoopClient) {
        super("Co-op");
        this._connection = connection;
        console.log(`Connected to session: ${connection.sessionId}. Sending protocol now.`);

        this._connection
            .addTwoWayProtocol("PushChar", "", this.physPushChar.bind(this))
            .addTwoWayProtocol("PopChar", "", this.physPopChar.bind(this))
            .addTwoWayProtocol("PushWord", "", this.physPushWord.bind(this))
            .addTwoWayProtocol("WordAsk", "", this.wordAskHandler.bind(this))
            .addTwoWayProtocol("WordResponse", "", this.wordResponseHandler.bind(this))
            .addTwoWayProtocol("DetermineStart", 0, this.determineStartHandler.bind(this))
            .addTwoWayProtocol("GiveUpAsk", "", this.giveUpAskHandler.bind(this))
            .addTwoWayProtocol("GiveUpResponse", "", this.giveUpResponseHandler.bind(this))
            .finishProtocol();
        this._connection.onClose = this.onClose.bind(this);
        this._rng = new CoopSeedablePRNG(Math.round(Math.random() * 0xFFFF));
        this._connection.sendMessage("DetermineStart", this._rng.seed);
    }

    private physGiveUp(): void {
        const targetChars = [];
        for (let i = 0; i < this.game.board.targetWord.length; i++)
            targetChars.push(new WordleCharacter(this.game.board.targetWord[i].toUpperCase(), WordleCharacterState.Green));
        this.board.setWord(this.game.board.currentWordIndex, targetChars);
        this.game.giveUp();
    }

    /**
     * Response to GiveUpAsk.
     * @param response "Yes" or "No," assume if "Yes" the other user has already given up.
     */
    private giveUpResponseHandler(response: string): void {
        if (response !== "Yes") {
            alert("Other user declined.");
            return;
        }
        this.physGiveUp();
    }

    /**
     * Asks if giving up is okay.
     */
    private giveUpAskHandler(): void {
        if (this.game.isWon() || this.game.isLost() || prompt("The other user wants to give up. Let them? (y/n)")?.toLowerCase() !== 'y') {
            this._connection.sendMessage("GiveUpResponse", "No");
            return;
        }
        this._connection.sendMessage("GiveUpResponse", "Yes");
        this.physGiveUp();
    }

    /**
     * Each client sends an integer between 0-0xFFFF, and whichever number is higher is the seed for this session.
     * Whoever sent the lower number plays first.
     * @param num Number from the other client
     */
    private determineStartHandler(num: number): void {
        if (this._rng.seed >= num)
            return;
        this._rng = new CoopSeedablePRNG(num);
        this._wordState++;
    }

    /**
     * Response to WordAsk from the other client, either "Yes" or "No." Assume if "Yes," the other client has already changed the word.
     * @param response Response from other client
     */
    private wordResponseHandler(response: string): void {
        if (!this._queuedWord) {
            console.log("Other user sent a WordResponse when no WordAsk was sent on our part.");
            return;
        }
        if (response !== "Yes") {
            alert("Other user declined.");
            return;
        }
        this.game.restart(this._queuedWord);
        this.createInterface();
        this._queuedWord = undefined;
    }

    /**
     * Asks if changing the word to the argument is okay
     * @param word Word to change to from other client
     */
    private wordAskHandler(word: string): void {
        const wordIndex = WordListManager.getWordIndex(word);
        if (wordIndex === -1 || prompt("The other user wishes to change the word. Let them? (y/n)")?.toLowerCase() !== 'y') {
            this._connection.sendMessage("WordResponse", "No");
            return;
        }
        this._connection.sendMessage("WordResponse", "Yes");
        this.game.restart(word);
        this.createInterface();
    }

    private tryStartNextGame(): void {
        if (!this.game.isWon() && !this.game.isLost())
            return;
        this.game.restart(WordListManager.getWordOnIndex(this._rng.next()));
        this.createInterface();
    }

    private physPushChar(char: string): void {
        this.tryStartNextGame();
        const charPos = this.game.board.currentCharacterIndex;
        if (this.game.onPushCharacter(char))
            this.board.setCharacter(this.game.board.currentWordIndex, charPos, char);
    }

    private physPopChar(): void {
        this.tryStartNextGame();
        this.game.onPopCharacter();
        this.board.setCharacter(this.game.board.currentWordIndex, this.game.board.currentCharacterIndex, ' ');
    }

    private physPushWord(): void {
        this.tryStartNextGame();
        const start = this.game.board.currentWordIndex;
        if (this.game.onPushWord())
            this._wordState++;
        this.board.setWord(start, this.game.board.data[start].word);
    }

    protected onPushWord(): void {
        if (this._wordState % 2 !== 0)
            return;
        this.physPushWord();
        this._connection.sendMessage("PushWord", this.game.board.currentWord.join());
    }

    protected onPopCharacter(): void {
        if (this._wordState % 2 !== 0)
            return;
        this.physPopChar();
        this._connection.sendMessage("PopChar", this.game.board.currentWord.join());
    }

    protected onPushCharacter(key: string): void {
        if (this._wordState % 2 !== 0)
            return;
        this.physPushChar(key);
        this._connection.sendMessage("PushChar", key);
    }

    protected tryStartNewGame(): void {
        if (!this.game.isWon() && !this.game.isLost())
            return;
        this.game.restart(WordListManager.getWordOnIndex(this._rng.next()));
        this.createInterface();
    }

    protected shortcut(shortcut: BrowserShortcut): void {
        switch (shortcut) {
            case BrowserShortcut.ToggleGuidedMode:
                this.game.guidedMode = !this.game.guidedMode;
                break;

            case BrowserShortcut.SetWordManual:
                const word = prompt("Word:", WordListManager.getRandomWord());
                if (word && WordListManager.getWordCoordinates(word)) {
                    this._queuedWord = word;
                    this._connection.sendMessage("WordAsk", this._queuedWord);
                }
                else
                    alert("Word \"" + word + "\" not found.");
                break;

            case BrowserShortcut.SetWordNumber:
                const numberString = prompt("Word number:", Math.floor(Math.random() * WordListManager.getTotalWordCount()).toString());
                if (!numberString)
                    break;
                let number = parseInt(numberString);
                this._queuedWord = WordListManager.getWordOnIndex(number);
                this._connection.sendMessage("WordAsk", this._queuedWord);
                break;

            case BrowserShortcut.GiveUp:
                this._connection.sendMessage("GiveUpAsk", "");
                break;

            case BrowserShortcut.Singleplayer: {
                const ans = prompt("Are you sure you want to disconnect? (y/n)");
                if (ans && ans.toLowerCase() === 'y') {
                    this._connection.close();
                    this.nextState = new BrowserSingleplayerState();
                }
                break;
            }

            case BrowserShortcut.HostGame: {
                const ans = prompt("Are you sure you want to disconnect? (y/n)");
                if (!ans || ans.toLowerCase() !== 'y')
                    break;
                CoopClient.host().then(i => {
                    this.nextState = new BrowserWaitingState(i.whenReady().then(j => new BrowserCoopState(j)), this);
                    prompt("Session id:", i.sessionId);
                });
                break;
            }

            case BrowserShortcut.JoinGame: {
                const ans = prompt("Are you sure you want to disconnect? (y/n)");
                if (!ans || ans.toLowerCase() !== 'y')
                    break;
                const sessionId = prompt("Session id:");
                if (sessionId)
                    CoopClient.join(sessionId).then(i => this.nextState = new BrowserWaitingState(i.whenReady().then(j => new BrowserCoopState(j)), this));
                break;
            }
        }
    }
}

declare global {
    interface Window { browserState: BrowserState; }
}

module BrowserWordle {
    export const canvasId = "wordle-coop";

    let state: BrowserState;
    let canvasElement: HTMLCanvasElement;
    let ctx: CanvasRenderingContext2D;
    let previousWidth: number;
    let previousHeight: number;

    function onKeyDown(this: Window, ev: KeyboardEvent): void {
        state.handleKeyClick(ev.key);
    }

    function onClick(this: Window, ev: MouseEvent): void {
        state.handleMouseClick(ev.x, ev.y);
    }

    export function main(): void {
        let _ctx = (canvasElement = document.getElementById(canvasId)! as HTMLCanvasElement).getContext("2d");
        if (!_ctx)
            throw new Error("Failed to create a canvas rendering context.");
        
        ctx = _ctx;
        addEventListener("keydown", onKeyDown);
        addEventListener("click", onClick);

        state = new BrowserSingleplayerState();
        window.browserState = state;

        let fpsElapsed = 0.0, fpsSamples = 0, avgFps = 0;
        let last = performance.now();
        const frame = (curr: number) => {
            if (previousWidth !== ctx.canvas.width || previousHeight !== ctx.canvas.height)
                state.handleResize(previousWidth = ctx.canvas.width, previousHeight = ctx.canvas.height);
            if (state.hasQueuedState()) {
                state = state.popQueuedState()!;
                state.handleResize(previousWidth, previousHeight);
                window.browserState = state;
            }

            const msDelta = curr - last;
            state.render(ctx, msDelta / 1000.0);

            fpsSamples++;
            if ((fpsElapsed += msDelta) > 100.0) {
                avgFps = 1000.0 / (fpsElapsed / fpsSamples);
                fpsElapsed = 0.0;
                fpsSamples = 0;
            }

            ctx.setTransform();
            ctx.font = "24px Sans-serif";
            ctx.textAlign = "left";
            ctx.textBaseline = "top";
            ctx.fillText(`FPS: ${avgFps.toFixed(0)}`, 10, 10);

            last = curr;

            // This function is asynchronous, so there is no stack overflow. But, it shows on the call stack how many frames there have been; is there a way to limit this?
            requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    }
}

BrowserWordle.main();