//
//  browser/browser.ts ~ RL
//
//  Browser backend for Wordle Coop
//

import { WordleCharacterState, WordleGame } from "../wordle.js";
import { WordListManager } from "../wordList.js";
import { BrowserCharAnimation, BrowserFramebuffer, BrowserRectangle, BrowserRegion, BrowserRenderAnimation, BrowserShakeAnimation, BrowserUIFactory, BrowserWinAnimation, BrowserWordAnimation } from "./render.js";

export abstract class BrowserState {
    public abstract hasQueuedState(): boolean;
    public abstract popQueuedState(): BrowserState | undefined;
    public abstract handleResize(wx: number, wy: number): void;
    public abstract handleMouseClick(x: number, y: number): void;
    public abstract handleKeyClick(input: string): void;
    public abstract render(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, delta: number): void;
}

enum BrowserShortcut {
    ToggleGuidedMode = 'T',
    SetWordManual = 'S',
    SetWordNumber = 'A',
    GiveUp = 'G',
}

export class BrowserMenuState extends BrowserState {
    private _userExited: boolean = false;
    private _previous: BrowserState;
    private _background: BrowserFramebuffer;

    private _transform: DOMMatrix;
    private _region: BrowserRegion;
    private _buttons: Array<BrowserRectangle>;

    public constructor(previous: BrowserState) {
        super();
        this._previous = previous;
        this._background = new BrowserFramebuffer(1, 1);

        const uiFactory = new BrowserUIFactory();
        [this._buttons, this._region] = uiFactory.createMenu(Object.keys(BrowserShortcut));
        this._transform = uiFactory.createTransform(this._region, this._region.centerRegion(1, 1));
    }

    public hasQueuedState(): boolean {
        return this._userExited;
    }

    public popQueuedState(): BrowserState | undefined {
        return this._previous;
    }

    public handleResize(wx: number, wy: number): void {
        this._previous.handleResize(wx, wy);
        this._background.resize(wx, wy);

        const unblurred = new BrowserFramebuffer(wx, wy);
        this._previous.render(unblurred.context, 0.0);
        this._background.context.filter = "blur(2px)";
        this._background.context.drawImage(unblurred.canvas, 0, 0);

        this._transform = new BrowserUIFactory().createTransform(this._region, this._region.centerRegion(wx, wy, 0.4));
    }

    public handleMouseClick(x: number, y: number): void {
        const translate = this._transform.inverse().transformPoint(new DOMPoint(x, y));
        x = translate.x;
        y = translate.y;
        for (let i = 1; i < this._buttons.length - 1; i++) { // first index is the background, don't care about that being pressed and last requires a special handler
            if (this._buttons[i].isPointInRectangle(x, y)) {
                this._previous.handleKeyClick(Object.values(BrowserShortcut)[i - 1]);
                this._userExited = true;
            }
        }
        if (this._buttons[this._buttons.length - 1].isPointInRectangle(x, y))
            this._userExited = true;
    }

    public handleKeyClick(input: string): void {
        this._userExited = true;
    }

    public render(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, delta: number): void {
        ctx.resetTransform();
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.drawImage(this._background.canvas, 0, 0);

        ctx.setTransform(this._transform);
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";
        for (let i = 0; i < this._buttons.length; i++)
            this._buttons[i].render(ctx, delta);
    }
}

export class BrowserGameState extends BrowserState {
    private _keys: Array<BrowserRectangle>;
    private _cells: Array<BrowserRectangle>;
    private _menuButton: BrowserRectangle;
    private _keysRegion: BrowserRegion;
    private _cellsRegion: BrowserRegion;
    private _animations: Array<BrowserCharAnimation>;
    private _currentWordAnimation: BrowserRenderAnimation | undefined;

    private _transform: DOMMatrix;
    private _previousMessage: string = "";

    private _game: WordleGame;
    private _popMessage = false;

    private _wx: number = 1;
    private _wy: number = 1;

    private _queuedState: BrowserState | undefined;

    public hasQueuedState(): boolean {
        return !!this._queuedState;
    }

    public popQueuedState(): BrowserState | undefined {
        const result = this._queuedState;
        this._queuedState = undefined;
        return result;
    }

    private onNewGame(): [Array<BrowserRectangle>, BrowserRegion, Array<BrowserRectangle>, BrowserRegion, BrowserRectangle] {
        const creator = new BrowserUIFactory();
        let cells: Array<BrowserRectangle>, keys: Array<BrowserRectangle>;
        let cellsRegion: BrowserRegion, keysRegion: BrowserRegion;
        [cells, cellsRegion] = creator.createCells(this._game.board, 0, 28);
        cellsRegion.top = 0;
        [keys, keysRegion] = creator.createKeyboard(0, cellsRegion.bottom + 18);

        if (cellsRegion.wx < keysRegion.wx)
            creator.moveRegionContents(keysRegion.wx / 2 - cellsRegion.wx / 2, 0, [cells, cellsRegion]);
        else
            creator.moveRegionContents(cellsRegion.wx / 2 - keysRegion.wx / 2, 0, [keys, keysRegion]);

        this._transform = creator.createTransform(cellsRegion.merge(keysRegion), cellsRegion.merge(keysRegion).centerRegion(this._wx, this._wy));
        return [cells, cellsRegion, keys, keysRegion, new BrowserRectangle(2, 0, 40, 24, { text: "MENU", font: "bold 24px \"Verdana\"" })];
    }

    public constructor(word: string = "") {
        super();

        this._game = new WordleGame();
        if (word !== "")
            this._game.restart(word);
        [this._cells, this._cellsRegion, this._keys, this._keysRegion, this._menuButton] = this.onNewGame();
        this._transform = new BrowserUIFactory().createTransform(this._cellsRegion.merge(this._keysRegion), this._cellsRegion.merge(this._keysRegion).centerRegion(1, 1));
        this._animations = [];
    }

    private convert1Dto2D(cellIndex: number): [number, number] {
        return [Math.floor(cellIndex / this._game.board.totalCharacterCount), cellIndex % this._game.board.totalCharacterCount];
    }

    private convert2Dto1D(wordIndex: number, charIndex: number): number {
        return wordIndex * this._game.board.totalCharacterCount + charIndex;
    }

    private convertCurrent2Dto1D(): number {
        return this.convert2Dto1D(this._game.board.currentWordIndex, this._game.board.currentCharacterIndex);
    }

    private syncBoardIndex(wordIndex: number, charIndex: number): void {
        this._cells[this.convert2Dto1D(wordIndex, charIndex)].text = this._game.board.data[wordIndex].word[charIndex].character.toUpperCase();
    }

    private addCharacterStatesToKeyboard(index: number): void {
        this._game.board.data[index].word.forEach(i => {
            let key = this._keys.find(j => j.text.toLowerCase() === i.character.toLowerCase());
            if (key && key.styleList.indexOf(key.style) < i.state) {
                key.style = key.styleList[i.state];
            }
        });
    }

    private giveUp(): void {
        this._game.giveUp();
        for (let i = 0; i < this._game.board.totalCharacterCount; i++) {
            const cell = this._cells[this.convert2Dto1D(this._game.board.currentWordIndex, i)];
            cell.style = cell.styleList[WordleCharacterState.Green];
            cell.text = this._game.board.targetWord[i].toUpperCase();
        }
        let cells = this._cells;
        const i = this.convert2Dto1D(this._game.board.currentWordIndex, 0);
        cells = cells.slice(i, i + this._game.board.totalCharacterCount);
        this._currentWordAnimation = new BrowserShakeAnimation(cells, this._game.board.currentWordIndex);
    }

    public render(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, delta: number): void {
        ctx.resetTransform();
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.setTransform(this._transform);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        for (let i = 0; i < this._cells.length; i++) {
            let animationIndex = this._animations.findIndex(v => v.id === i);
            if (this._currentWordAnimation !== undefined && this.convert1Dto2D(i)[0] === this._currentWordAnimation.id) {
                this._currentWordAnimation.render(ctx, delta);
                if (this._currentWordAnimation.isDone()) {
                    this.addCharacterStatesToKeyboard(this._currentWordAnimation.id);
                    if (this._game.isWon() && this._currentWordAnimation.constructor.name !== "BrowserWinAnimation")
                        this._currentWordAnimation = new BrowserWinAnimation(this._cells.slice(i, i + this._game.board.totalCharacterCount), this._currentWordAnimation.id);
                    else
                        this._currentWordAnimation = undefined;
                }
                i += this._game.board.totalCharacterCount - 1;
            }
            else if (animationIndex !== -1) {
                this._animations[animationIndex].render(ctx, delta);
                if (this._animations[animationIndex].isDone())
                    this._animations.splice(animationIndex, 1);
            }
            else {
                this._cells[i].render(ctx, delta);
            }
        }

        for (let i = 0; i < this._keys.length; i++)
            this._keys[i].render(ctx, delta);

        this._menuButton.render(ctx, delta);
        ctx.font = "24px Sans-serif";
        ctx.textBaseline = "top";
        if (this._popMessage) {
            this._previousMessage = this._game.popMessage();
            this._popMessage = false;
        }
        ctx.textAlign = "right";
        if (this._currentWordAnimation === undefined || this._currentWordAnimation.renderMessageDuring)
            ctx.fillText(this._previousMessage, this._cellsRegion.x + Math.max(this._cellsRegion.wx, this._keysRegion.wx), 0);

        if (this._game.guidedMode) {
            ctx.textAlign = "left";
            ctx.font = "10px Sans-Serif";
            ctx.fillText("Guided mode -- Shift+T to toggle", 0, this._cellsRegion.bottom + 4);
        }
    }

    public handleResize(wx: number, wy: number): void {
        const target = this._cellsRegion.merge(this._keysRegion);
        this._transform = new BrowserUIFactory().createTransform(target, target.centerRegion(this._wx = wx, this._wy = wy));
        this._popMessage = true;
    }

    public handleMouseClick(x: number, y: number): void {
        const translate = this._transform.inverse().transformPoint(new DOMPoint(x, y));
        x = translate.x;
        y = translate.y;

        for (let i = 0; i < this._keys.length; i++) {
            if (this._keys[i].isPointInRectangle(x, y))
                this.handleKeyClick(this._keys[i].text === "\u232B" ? "Backspace" : this._keys[i].text);
        }

        if (this._menuButton.isPointInRectangle(x, y))
            this._queuedState = new BrowserMenuState(this);
    }

    private handleShortcuts(key: string): void {
        if (key.length !== 1)
            throw new Error("Key provided is not a character.");

        switch (key) {
            case BrowserShortcut.ToggleGuidedMode:
                this._game.guidedMode = !this._game.guidedMode;
                break;

            case BrowserShortcut.SetWordManual:
                const word = prompt("Word:", WordListManager.getRandomWord());
                if (word && WordListManager.getWordCoordinates(word)) {
                    this._game.restart(word);
                    [this._cells, this._cellsRegion, this._keys, this._keysRegion, this._menuButton] = this.onNewGame();
                }
                else
                    alert("Word \"" + word + "\" not found.");
                break;

            case BrowserShortcut.SetWordNumber:
                const numberString = prompt("Word number:", Math.floor(Math.random() * WordListManager.getTotalWordCount()).toString());
                if (!numberString)
                    break;
                let number = parseInt(numberString);
                this._game.restart(WordListManager.getWordOnIndex(number));
                [this._cells, this._cellsRegion, this._keys, this._keysRegion, this._menuButton] = this.onNewGame();
                break;

            case BrowserShortcut.GiveUp:
                this.giveUp();
                break;
        }
    }

    private colorWord(wordIndex: number): number {
        let result = 0;
        this._game.board.data[wordIndex].word.forEach((v, i) => {
            const cell = this._cells[this.convert2Dto1D(wordIndex, i)];
            cell.style = cell.styleList[v.state];
            result += v.state;
        });
        return result;
    }

    private handlePushWord(): void {
        const index = this._game.board.currentWordIndex * this._game.board.totalCharacterCount;
        const previousIndex = this._game.board.currentWordIndex;
        let previous = new BrowserUIFactory().createWord(this._game.board.currentWord, this._cells[index].x, this._cells[index].y)[0];
        this._animations = this._animations.filter(v => this.convert1Dto2D(v.id)[0] !== previousIndex);

        if (this._game.onPushWord()) {
            this._currentWordAnimation = new BrowserWordAnimation(previous, this._cells.slice(index, index + this._game.board.totalCharacterCount), previousIndex);
            this.colorWord(previousIndex);
        }
        else
            this._currentWordAnimation = new BrowserShakeAnimation(previous, previousIndex);
    }

    private handlePopCharacter(): void {
        if (this._currentWordAnimation)
            this._currentWordAnimation = undefined;
        this._game.onPopCharacter();
        this.syncBoardIndex(this._game.board.currentWordIndex, this._game.board.currentCharacterIndex);
    }

    private handlePushCharacter(char: string): void {
        if (char.toUpperCase() === char)
            this.handleShortcuts(char);
        else {
            let index = this.convertCurrent2Dto1D();
            if (this._game.onPushCharacter(char)) {
                if (this._currentWordAnimation)
                    this._currentWordAnimation = undefined;
                this._cells[index].text = char.toUpperCase();
                let anim = new BrowserCharAnimation(this._cells[index], 5, index);
                let existingIndex = this._animations.findIndex(a => a.id === index);
                if (existingIndex !== -1)
                    this._animations[existingIndex] = anim;
                else
                    this._animations.push(anim);
            }
        }
    }

    public handleKeyClick(input: string): void {
        if (this._currentWordAnimation !== undefined)
            return;

        if (this._game.startQueuedGame())
            [this._cells, this._cellsRegion, this._keys, this._keysRegion, this._menuButton] = this.onNewGame();

        const lowerInput = input.toLowerCase();
        if (lowerInput === "enter")
            this.handlePushWord();
        else if (lowerInput === "backspace")
            this.handlePopCharacter();
        else if (lowerInput.length === 1 && /^[a-z]+$/.test(lowerInput))
            this.handlePushCharacter(input);
        else
            return;

        this._popMessage = true;
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

        state = new BrowserGameState();
        window.browserState = state;

        let fpsElapsed = 0.0;
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
            if ((fpsElapsed += msDelta) > 1000.0) {
                fpsElapsed = 0.0;
                console.log(1000.0 / msDelta);
            }
            last = curr;

            requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    }
}

BrowserWordle.main();