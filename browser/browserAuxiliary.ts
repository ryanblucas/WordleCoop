//
//  browser/browserAuxiliary.ts ~ RL
//
//  Auxiliary browser states -- basically except the two main game states.
//

import { WordleGame } from "../wordle.js";
import { BrowserFramebuffer, BrowserKeyboard, BrowserRectangle, BrowserRegion, BrowserRenderTarget, BrowserUIFactory, BrowserWordleBoard } from "./render.js";

export abstract class BrowserState extends BrowserRenderTarget {
    public abstract hasQueuedState(): boolean;
    public abstract popQueuedState(): BrowserState | undefined;
    public abstract handleResize(wx: number, wy: number): void;
    public abstract handleMouseClick(x: number, y: number): void;
    public abstract handleKeyClick(input: string): void;
    public abstract render(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, delta: number): void;
}

export abstract class BrowserGameState extends BrowserState {
    protected transform: DOMMatrix;
    protected keyboard: BrowserKeyboard;
    protected board: BrowserWordleBoard;
    protected game: WordleGame;
    protected menuButton: BrowserRectangle;
    protected message: string = "";
    protected messagePos: number;
    protected gameName: string;

    protected region: BrowserRegion;
    protected wx: number = 1;
    protected wy: number = 1;

    protected nextState: BrowserState | undefined;

    protected createInterface(): void {
        this.board = new BrowserWordleBoard(0, 28, this.game.board.totalWordCount, this.game.board.totalCharacterCount);
        this.keyboard = new BrowserKeyboard(0, this.board.region.bottom + 18);
        if (this.board.region.wx < this.keyboard.region.wx)
            this.board.region = new BrowserRegion(this.board.region.x + this.keyboard.region.wx / 2 - this.board.region.wx / 2, this.board.region.y, this.board.region.wx, this.board.region.wy);
        else
            this.keyboard.region = new BrowserRegion(this.keyboard.region.x + this.board.region.wx / 2 - this.keyboard.region.wx / 2, this.keyboard.region.y, this.keyboard.region.wx, this.keyboard.region.wy);
        this.messagePos = Math.min(this.board.region.x, this.keyboard.region.x) + Math.max(this.board.region.wx, this.keyboard.region.wx);
        this.menuButton = new BrowserRectangle(0, 0, new BrowserUIFactory().measureText("bold 24px \"Verdana\"", "MENU")[0], 24, { text: "MENU", font: "bold 24px \"Verdana\"" });
        this.region = this.board.region.merge(this.keyboard.region).merge(this.menuButton.region);
        this.transform = new BrowserUIFactory().createTransform(this.region, this.region.centerRegion(this.wx, this.wy));
    }

    public constructor(gameName: string) {
        super();
        this.game = new WordleGame();
        this.gameName = gameName;

        // -- mandatory for TypeScript
        this.transform = new DOMMatrix();
        this.keyboard = new BrowserKeyboard(0, 0);
        this.board = new BrowserWordleBoard(0, 0, 0, 0);
        this.menuButton = new BrowserRectangle(0, 0, 0, 0);
        this.messagePos = 0;
        this.region = new BrowserRegion(0, 0, 0, 0);
        // --

        this.createInterface();
    }

    public hasQueuedState(): boolean {
        return !!this.nextState;
    }

    public popQueuedState(): BrowserState | undefined {
        const state = this.nextState;
        this.nextState = undefined;
        return state;
    }

    public handleResize(wx: number, wy: number): void {
        this.transform = new BrowserUIFactory().createTransform(this.region, this.region.centerRegion(this.wx = wx, this.wy = wy));
    }

    public handleMouseClick(x: number, y: number): void {
        const transformed = this.transform.inverse().transformPoint(new DOMPoint(x, y));
        x = transformed.x;
        y = transformed.y;
        this.keyboard.handleMouseClick(x, y);
        if (this.menuButton.isPointInRectangle(x, y))
            this.nextState = new BrowserMenuState(this);
    }

    public handleKeyClick(input: string): void {
        this._changeUiAt = this.game.board.currentWordIndex;
        if (input.toUpperCase() === input && Object.values(BrowserShortcut).includes(input as BrowserShortcut))
            this.shortcut(input as BrowserShortcut);
        else
            this.keyboard.handleKeyClick(input);
    }

    protected abstract onPushWord(): void;
    protected abstract onPopCharacter(): void;
    protected abstract onPushCharacter(key: string): void;
    protected abstract tryStartNewGame(): void;
    protected abstract shortcut(shortcut: BrowserShortcut): void;

    private _changeUiAt: number = -1;
    public render(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, delta: number): void {
        const key = this.keyboard.getCurrentKey();
        if (key !== "" && this.board.wordAnimation.isDone()) {
            this.tryStartNewGame();
            if (key === "Enter")
                this.onPushWord();
            else if (key === "Backspace")
                this.onPopCharacter();
            else
                this.onPushCharacter(key);
        }

        if (this._changeUiAt !== -1 && this.board.wordAnimation.renderMessageDuring) {
            this.message = this.game.popMessage();
            this.game.board.data[this._changeUiAt].word.forEach(v => {
                const cell = this.keyboard.getCharRectangle(v.character);
                if (cell.styleList.indexOf(cell.style) < v.state)
                    cell.style = cell.styleList[v.state];
            });
            this._changeUiAt = -1;
        }

        ctx.resetTransform();
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.setTransform(this.transform);

        this.board.render(ctx, delta);
        this.keyboard.render(ctx, delta);

        ctx.textBaseline = "middle";
        ctx.textAlign = "center";
        this.menuButton.render(ctx, delta);

        ctx.font = "24px Sans-serif";
        ctx.textBaseline = "top";
        ctx.textAlign = "right";
        ctx.fillText(this.message, this.messagePos, 0, 250);

        if (this.game.guidedMode) {
            ctx.textAlign = "left";
            ctx.font = "10px Sans-Serif";
            ctx.fillText("Guided mode -- Shift+T/Menu to toggle", 0, this.board.region.bottom + 4, this.region.wx / 2);
        }
        ctx.textAlign = "right";
        ctx.font = "10px Sans-Serif";
        ctx.fillText(`${this.gameName} game`, this.region.right, this.board.region.bottom + 4, this.region.wx / 2);
    }
}

/**
 *  Browser shortcuts/actions. Values must be a capital letter.
 */
export enum BrowserShortcut {
    ToggleGuidedMode = 'T',
    SetWordManual = 'S',
    SetWordNumber = 'A',
    GiveUp = 'G',
    JoinGame = 'J',
    HostGame = 'H',
    Singleplayer = 'P',
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
 * Blurs background, displays text and waits for promise to resolve and return the next state.
 */
export class BrowserWaitingState extends BrowserState {
    private _promise: Promise<BrowserState>;
    private _prevState: BrowserState;
    private _text: string;
    private _nextState: BrowserState | undefined;

    private _background: BrowserFramebuffer;

    public constructor(promise: Promise<BrowserState>, prevState: BrowserState, text: string = "Waiting...") {
        super();
        this._promise = promise;
        this._prevState = prevState;
        this._text = text;

        this._background = new BrowserFramebuffer(1, 1);
        this._promise.then(v => this._nextState = v);
        this._promise.catch(e => {
            this._nextState = this._prevState;
            alert(`Connection error: ${e}`);
        });
    }

    public hasQueuedState(): boolean {
        return !!this._nextState;
    }

    public popQueuedState(): BrowserState | undefined {
        return this._nextState;
    }

    public handleResize(wx: number, wy: number): void {
        this._background.resize(wx, wy);
        this._prevState.handleResize(wx, wy);
        const unblurred = new BrowserFramebuffer(wx, wy);
        this._prevState.render(unblurred.context, 0.0);
        this._background.context.filter = "blur(2px)";
        this._background.context.drawImage(unblurred.canvas, 0, 0);
    }

    public handleMouseClick(x: number, y: number): void {

    }

    public handleKeyClick(input: string): void {
        if (input === "Escape") { // TO DO: alert the previous state/promise that this happened?
            console.log("User prompted for loading state to fall back!");
            this._nextState = this._prevState;
        }
    }

    public render(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, delta: number): void {
        ctx.setTransform();
        ctx.drawImage(this._background.canvas, 0, 0);
        ctx.font = "32px Sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(this._text, this._background.canvas.width / 2, this._background.canvas.height / 2, this._background.canvas.width - 32);
    }
}