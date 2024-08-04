//
//  browser/browser.ts ~ RL
//
//  Browser backend for Wordle Coop
//

import { BrowserClient } from "../coop.js";
import { WordleBoard, WordleCharacterState, WordleGame, WordleWord } from "../wordle.js";
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

/**
 *  Browser shortcuts/actions. Values must be a capital letter.
 */
enum BrowserShortcut {
    ToggleGuidedMode = 'T',
    SetWordManual = 'S',
    SetWordNumber = 'A',
    GiveUp = 'G',
    JoinGame = 'J',
    HostGame = 'H',
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
        // pascal case is when every letter is capitalized, like the class names and enum names in the project.
        // Ironically, the variable name is camelCase, not PascalCase.
        const pascalCase = Object.keys(BrowserShortcut);
        for (let i = 0; i < pascalCase.length; i++) {
            for (let j = pascalCase[i].length - 1; j > 0; j--) { // skip first character, always uppercase
                if (pascalCase[i][j] == pascalCase[i][j].toUpperCase())
                    pascalCase[i] = pascalCase[i].slice(0, j) + ' ' + pascalCase[i].slice(j);
            }
        }
        [this._buttons, this._region] = uiFactory.createMenu(pascalCase);
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

        this._transform = new BrowserUIFactory().createTransform(this._region, this._region.centerRegion(wx, wy, 0.5));
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

/**
 * Represents both the UI component of a keyboard and the functionality.
 */
export class BrowserKeyboard {
    private _keys: Array<BrowserRectangle>;
    private _image: BrowserFramebuffer;
    private _needsInvalidate: boolean;

    private _keysRegion: BrowserRegion;
    private _adjRegion: BrowserRegion;
    private _transform: DOMMatrix;

    public get region(): BrowserRegion {
        return this._adjRegion;
    }

    public set region(value: BrowserRegion) {
        this._adjRegion = value;
        this._transform = new BrowserUIFactory().createTransform(this._keysRegion, this._adjRegion);
        this._needsInvalidate = true;
    }

    public constructor(x: number, y: number) {
        [this._keys, this._keysRegion] = new BrowserUIFactory().createKeyboard();
        this._image = new BrowserFramebuffer(1, 1);
        this._needsInvalidate = true;

        this._transform = new DOMMatrix([1, 0, 0, 1, 0, 0]).translate(x, y);
        this._adjRegion = this._keysRegion.transform(this._transform);
    }

    public render(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, delta: number): void {
        if (ctx.canvas.width !== this._image.canvas.width || ctx.canvas.height !== this._image.canvas.height) {
            this._image = new BrowserFramebuffer(ctx.canvas.width, ctx.canvas.height);
            this._needsInvalidate = true;
        }
        const mat4 = ctx.getTransform();
        if (this._needsInvalidate || mat4 !== this._image.context.getTransform()) {
            this._image.context.setTransform();
            this._image.context.clearRect(0, 0, this._image.canvas.width, this._image.canvas.height);
            this._image.context.setTransform(mat4.multiply(this._transform));
            for (let i = 0; i < this._keys.length; i++)
                this._keys[i].render(this._image.context, delta);
            this._image.context.setTransform(mat4);
            this._needsInvalidate = false;
        }
        ctx.setTransform();
        ctx.drawImage(this._image.canvas, 0, 0);
        ctx.setTransform(mat4);
    }
    
    public getCharRectangle(character: string): BrowserRectangle {
        character = character.toLowerCase();
        character = character === "backspace" ? "\u232B" : character;
        const realResult = this._keys.find(v => v.text === character);
        if (!realResult) {
            console.log("Invalid character \"" + character + "\" passed to getCharRectangle, defaulting to blank rectangle.");
            return new BrowserRectangle(0, 0, 1, 1);
        }
        return realResult;
    }

    /**
     * Handles any mouse input
     * @param x Translated x-coordinate of the mouse input
     * @param y Translated y-coordinate of the mouse input
     * @returns The character pressed by the user, or an empty string if no character was pressed by the user
     */
    public handleMouseClick(x: number, y: number): string {
        const pt = this._transform.inverse().transformPoint(new DOMPoint(x, y));
        for (let i = 0; i < this._keys.length; i++) {
            if (this._keys[i].isPointInRectangle(pt.x, pt.y))
                return this._keys[i].text === "\u232B" ? "Backspace" : this._keys[i].text;
        }
        return "";
    }
}

/**
 * Represents the game's character board and its UI
 */
export class BrowserWordleBoard {
    private _image: BrowserFramebuffer;
    private _needsInvalidate: boolean;

    private _cells: Array<BrowserRectangle>;
    private _animations: Array<BrowserCharAnimation>;
    private _currentWordAnimation: BrowserRenderAnimation | undefined;

    private _cellsRegion: BrowserRegion;
    private _adjRegion: BrowserRegion;
    private _transform: DOMMatrix;

    private _board: WordleBoard;
    public get game(): WordleBoard {
        return this._board;
    }

    public get region(): BrowserRegion {
        return this._adjRegion;
    }

    public set region(value: BrowserRegion) {
        this._adjRegion = value;
        this._transform = new BrowserUIFactory().createTransform(this._cellsRegion, this._adjRegion);
    }

    public get wordAnimation(): BrowserRenderAnimation | undefined {
        return this._currentWordAnimation;
    }

    public setWordAnimationAt(value: BrowserRenderAnimation | undefined, wordIndex: number): void {
        this._currentWordAnimation = value;
        if (value) {
            value.id = wordIndex;
            this._needsInvalidate = true;
        }
    }

    public addCharAnimation(anim: BrowserCharAnimation, wordIndex: number, charIndex: number): void {
        anim.id = wordIndex * this._board.totalCharacterCount + charIndex;
        this._animations.push(anim);
        this._needsInvalidate = true;
    }

    public constructor(board: WordleBoard, x: number, y: number) {
        this._board = board;
        [this._cells, this._cellsRegion] = new BrowserUIFactory().createCells(this._board);
        this._animations = [];
        this._image = new BrowserFramebuffer(1, 1);
        this._needsInvalidate = true;

        this._transform = new DOMMatrix([1, 0, 0, 1, 0, 0]).translate(x, y);
        this._adjRegion = this._cellsRegion.transform(this._transform);
    }

    public cellAt(wordIndex: number, charIndex: number): BrowserRectangle {
        return this._cells[wordIndex * this._board.totalCharacterCount + charIndex];
    }

    public wordAt(wordIndex: number): Array<BrowserRectangle> {
        return this._cells.slice(wordIndex * this._board.totalCharacterCount, (wordIndex + 1) * this._board.totalCharacterCount);
    }

    public syncBoardIndex(wordIndex: number, charIndex: number): void {
        this.cellAt(wordIndex, charIndex).text = this._board.data[wordIndex].word[charIndex].character.toUpperCase();
    }

    public updateWordAndAnimation(previousIndex: number, success: boolean): void {
        const index = previousIndex * this._board.totalCharacterCount;
        let previous = new BrowserUIFactory().createWord(this._board.data[previousIndex], this._cells[index].x, this._cells[index].y)[0];
        this._animations = this._animations.filter(v => Math.floor(v.id / this._board.totalCharacterCount) !== previousIndex);

        if (success) {
            this.setWordAnimationAt(new BrowserWordAnimation(previous, this._cells.slice(index, index + this._board.totalCharacterCount)), previousIndex);
            this._board.data[previousIndex].word.forEach((v, i) => {
                const cell = this.cellAt(previousIndex, i);
                cell.style = cell.styleList[v.state];
            });
        }
        else
            this.setWordAnimationAt(new BrowserShakeAnimation(previous, previousIndex), previousIndex);
    }

    public updateCharAndAnimation(char: string, wordIndex: number, charIndex: number): void {
        const index = wordIndex * this._board.totalCharacterCount + charIndex;
        if (this._currentWordAnimation)
            this._currentWordAnimation = undefined;
        this._cells[index].text = char.toUpperCase();
        const anim = new BrowserCharAnimation(this._cells[index], 5);
        const existingIndex = this._animations.findIndex(a => a.id === index);
        if (existingIndex !== -1)
            this._animations[existingIndex] = anim;
        else
            this.addCharAnimation(anim, wordIndex, charIndex);
    }

    public handlePopCharacter(): void {
        if (this._currentWordAnimation)
            this._currentWordAnimation = undefined;
        this.syncBoardIndex(this._board.currentWordIndex, this._board.currentCharacterIndex);
    }

    /**
     * Renders game board to ctx, using delta parameter
     * @param ctx Canvas to render to. Transform in use prior is conserved.
     * @param delta Time in milliseconds since the last render
     * @returns Word then char animation that was used
     */
    public render(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, delta: number): BrowserRenderAnimation | undefined {
        if (ctx.canvas.width !== this._image.canvas.width || ctx.canvas.height !== this._image.canvas.height) {
            this._image = new BrowserFramebuffer(ctx.canvas.width, ctx.canvas.height);
            this._needsInvalidate = true;
        }

        const mat4 = ctx.getTransform();
        let result: BrowserRenderAnimation | undefined = undefined;
        if (this._needsInvalidate || mat4 !== this._image.context.getTransform()) {
            this._image.context.setTransform(mat4.multiply(this._transform));
            this._image.context.textAlign = "center";
            this._image.context.textBaseline = "middle";
            for (let i = 0; i < this._cells.length; i++) {
                let animationIndex = this._animations.findIndex(v => v.id === i);
                if (this._currentWordAnimation !== undefined && Math.floor(i / this._board.totalCharacterCount) === this._currentWordAnimation.id) {
                    result = this._currentWordAnimation;
                    this._currentWordAnimation.render(this._image.context, delta);
                    i += this._board.totalCharacterCount - 1;
                    if (this._currentWordAnimation.isDone())
                        this._currentWordAnimation = undefined;
                    }
                else if (animationIndex !== -1) {
                    if (result !== this._currentWordAnimation)
                        result = this._animations[animationIndex];
                    this._animations[animationIndex].render(this._image.context, delta);
                    if (this._animations[animationIndex].isDone())
                        this._animations.splice(animationIndex, 1);
                }
                else
                    this._cells[i].render(this._image.context, delta);
            }
            this._image.context.setTransform(mat4);
            this._needsInvalidate = this.wordAnimation !== undefined || this._animations.length !== 0;
        }
        ctx.setTransform();
        ctx.drawImage(this._image.canvas, 0, 0);
        ctx.setTransform(mat4);
        return result;
    }
}

export class BrowserGameState extends BrowserState {
    private _menuButton: BrowserRectangle;
    private _previousMessage: string = "";
    private _board: BrowserWordleBoard;
    private _keyboard: BrowserKeyboard;

    private _transform: DOMMatrix;

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

    /**
     * Region encompassing all components of this state.
     * This gets calculated every time it is called and it is not centered.
     */
    public get region(): BrowserRegion {
        return this._board.region.merge(this._keyboard.region).merge(this._menuButton.region);
    }

    /**
     * Clears UI state to new board
     * @returns Cells, cell region, keyboard, MENU button, and the transform in that order.
     */
    private onNewGame(): [BrowserWordleBoard, BrowserKeyboard, BrowserRectangle, DOMMatrix] {
        const creator = new BrowserUIFactory();
        const board = new BrowserWordleBoard(this._game.board, 0, 28);
        const keyboard = new BrowserKeyboard(0, board.region.bottom + 18);
        const menuButton = new BrowserRectangle(0, 0, creator.measureText("bold 24px \"Verdana\"", "MENU")[0], 24, { text: "MENU", font: "bold 24px \"Verdana\"" });

        if (board.region.wx < keyboard.region.wx)
            board.region = new BrowserRegion(board.region.x + keyboard.region.wx / 2 - board.region.wx / 2, board.region.y, board.region.wx, board.region.wy);
        else
            keyboard.region = new BrowserRegion(keyboard.region.x + board.region.wx / 2 - keyboard.region.wx / 2, keyboard.region.y, keyboard.region.wx, keyboard.region.wy);

        const finalRegion = board.region.merge(keyboard.region).merge(menuButton.region);
        return [board, keyboard, menuButton, creator.createTransform(finalRegion, finalRegion.centerRegion(this._wx, this._wy))];
    }

    public constructor(word: string = "") {
        super();

        this._game = new WordleGame();
        if (word !== "")
            this._game.restart(word);
        [this._board, this._keyboard, this._menuButton, this._transform] = this.onNewGame();
    }

    private giveUp(): void {
        this._game.giveUp();
        for (let i = 0; i < this._game.board.totalCharacterCount; i++) {
            const cell = this._board.cellAt(this._game.board.currentWordIndex, i);
            cell.style = cell.styleList[WordleCharacterState.Green];
            cell.text = this._game.board.targetWord[i].toUpperCase();
        }
        this._board.setWordAnimationAt(new BrowserShakeAnimation(this._board.wordAt(this._game.board.currentWordIndex)), this._game.board.currentWordIndex);
    }

    public render(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, delta: number): void {
        ctx.resetTransform();
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.setTransform(this._transform);

        const anim = this._board.render(ctx, delta);
        if (anim && anim.isDone()) {
            this._game.board.data[anim.id].word.forEach(v => {
                const rect = this._keyboard.getCharRectangle(v.character);
                rect.style = rect.styleList[v.state];
            });
            if (this._game.isWon() && anim.constructor.name !== "BrowserWinAnimation")
                this._board.setWordAnimationAt(new BrowserWinAnimation(this._board.wordAt(anim.id)), anim.id);
        }
        this._keyboard.render(ctx, delta);
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";
        this._menuButton.render(ctx, delta);

        if (this._popMessage) {
            this._previousMessage = this._game.popMessage();
            this._popMessage = false;
        }

        ctx.font = "24px Sans-serif";
        ctx.textBaseline = "top";
        ctx.textAlign = "right";
        if (this._board.wordAnimation === undefined || this._board.wordAnimation.renderMessageDuring)
            ctx.fillText(this._previousMessage, Math.min(this._board.region.x, this._keyboard.region.x) + Math.max(this._board.region.wx, this._keyboard.region.wx), 0, 250);

        if (this._game.guidedMode) {
            ctx.textAlign = "left";
            ctx.font = "10px Sans-Serif";
            ctx.fillText("Guided mode -- Shift+T to toggle", 0, this._board.region.bottom + 4);
        }
    }

    public handleResize(wx: number, wy: number): void {
        const target = this.region;
        this._transform = new BrowserUIFactory().createTransform(target, target.centerRegion(this._wx = wx, this._wy = wy));
        this._popMessage = true;
    }

    public handleMouseClick(x: number, y: number): void {
        const translate = this._transform.inverse().transformPoint(new DOMPoint(x, y));
        x = translate.x;
        y = translate.y;

        this.handleKeyClick(this._keyboard.handleMouseClick(x, y));

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
                    [this._board, this._keyboard, this._menuButton, this._transform] = this.onNewGame();
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
                [this._board, this._keyboard, this._menuButton, this._transform] = this.onNewGame();
                break;

            case BrowserShortcut.GiveUp:
                this.giveUp();
                break;

            case BrowserShortcut.HostGame:
                BrowserClient.host().then(v => console.log(v.sessionId));
                break;
            case BrowserShortcut.JoinGame:
                const sessionId = prompt("Session id:");
                if (sessionId)
                    BrowserClient.join(sessionId).then(v => console.log(v.sessionId));
                break;
        }
    }

    private handlePushCharacter(char: string): void {
        if (char.toUpperCase() === char)
            this.handleShortcuts(char);
        else {
            const charIndex = this._game.board.currentCharacterIndex;
            if (this._game.onPushCharacter(char))
                this._board.updateCharAndAnimation(char, this._game.board.currentWordIndex, charIndex);
        }
    }

    public handleKeyClick(input: string): void {
        if (this._board.wordAnimation !== undefined || input === "")
            return;

        if (this._game.startQueuedGame())
            [this._board, this._keyboard, this._menuButton, this._transform] = this.onNewGame();

        const lowerInput = input.toLowerCase();
        if (lowerInput === "enter")
            this._board.updateWordAndAnimation(this._game.board.currentWordIndex, this._game.onPushWord());
        else if (lowerInput === "backspace") {
            this._game.onPopCharacter();
            this._board.handlePopCharacter();
        }
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