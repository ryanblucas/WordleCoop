//
//  browser/browserAuxiliary.ts ~ RL
//
//  Auxiliary browser states -- basically except the two main game states.
//

import { WordleGame } from "../wordle.js";
import { BrowserFramebuffer, BrowserKeyboard, BrowserRectangle, BrowserRegion, BrowserRenderTarget, BrowserUIFactory, BrowserUIPlace, BrowserWordleBoard } from "./render.js";

export abstract class BrowserState extends BrowserRenderTarget {
    /**
     * How much of the screen is occupied by the region of this state.
     */
    public coverage: number;

    public constructor(x: number, y: number, wx: number, wy: number, coverage: number = 0.9) {
        super(x, y, wx, wy);
        this.coverage = coverage;
    }

    public abstract hasQueuedState(): boolean;
    public abstract popQueuedState(): BrowserState | undefined;
    public abstract handleMouseClick(x: number, y: number): void;
    public abstract handleKeyClick(input: string): void;
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

export abstract class BrowserGameState extends BrowserState {
    protected keyboard: BrowserKeyboard;
    protected board: BrowserWordleBoard;
    protected game: WordleGame;
    protected menuButton: BrowserRectangle;
    protected message: string = "";
    protected gameName: string;
    protected nextState: BrowserState | undefined;

    protected createInterface(): void {
        const factory = new BrowserUIFactory();
        this.board = factory.addComponent(new BrowserWordleBoard(0, 0, this.game.board.totalWordCount, this.game.board.totalCharacterCount), BrowserUIPlace.Middle);
        this.keyboard = factory.addComponent(new BrowserKeyboard(0, 18), BrowserUIPlace.BottomMiddle, BrowserUIPlace.BottomMiddle);
        this.menuButton = factory.addText(new BrowserRectangle(0, -4, 0, 0, { text: "MENU", font: "bold 24px \"Verdana\"" }), BrowserUIPlace.TopLeft, BrowserUIPlace.TopRight);
        this.x = factory.region.x;
        this.y = factory.region.y;
        this.wx = factory.region.wx;
        this.wy = factory.region.wy;
    }

    public constructor(gameName: string) {
        super(0, 0, 0, 0);
        this.game = new WordleGame();
        this.gameName = gameName;

        // -- mandatory for TypeScript
        this.keyboard = new BrowserKeyboard(0, 0);
        this.board = new BrowserWordleBoard(0, 0, 0, 0);
        this.menuButton = new BrowserRectangle(0, 0, 0, 0);
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

    public handleMouseClick(x: number, y: number): void {
        this.keyboard.handleMouseClick(x, y);
        if (this.menuButton.isPointInRectangle(x, y))
            this.nextState = new BrowserMenuState(this);
    }

    public handleKeyClick(input: string): void {
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
            this._changeUiAt = this.game.board.currentWordIndex;
            if (key.toLowerCase() === "enter")
                this.onPushWord();
            else if (key.toLowerCase() === "backspace")
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

        this.board.render(ctx, delta);
        this.keyboard.render(ctx, delta);

        ctx.textBaseline = "middle";
        ctx.textAlign = "center";
        this.menuButton.render(ctx, delta);

        ctx.font = "24px Sans-serif";
        ctx.textBaseline = "top";
        ctx.textAlign = "right";
        ctx.fillText(this.message, this.right, this.top, 250);

        ctx.font = "10px Sans-Serif";
        ctx.fillText(`${this.gameName} game`, this.right, this.board.bottom + 4, this.wx / 2);
        if (this.game.guidedMode) {
            ctx.textAlign = "left";
            ctx.fillText("Guided mode -- Shift+T/Menu to toggle", this.left, this.board.bottom + 4, this.wx / 2);
        }
    }
}

export class BrowserMenuState extends BrowserState {
    private _userExited: boolean = false;
    private _previous: BrowserState;
    private _background: BrowserFramebuffer;
    private _buttons: Array<BrowserRectangle>;

    private createInterface(options: Array<string>): [Array<BrowserRectangle>, BrowserRegion] {
        const font = "14px Sans-serif", space = 15, exitButtonSize = 6;
        this._background.context.font = font;
        this._background.context.textBaseline = "top";

        const region = new BrowserRegion(0, 0, 0, space);
        for (let i = 0; i < options.length; i++) {
            const textMetrics = this._background.context.measureText(options[i]);
            region.wx = Math.max(region.wx, textMetrics.width);
            region.wy += textMetrics.emHeightDescent + space;
        }
        region.wx += space * 2;

        const buttons: Array<BrowserRectangle> = [];
        buttons.push(new BrowserRectangle(region.x, region.y, region.wx, region.wy, { style: "Gainsboro" }));
        for (let i = 0; i < options.length; i++) {
            const textMetrics = this._background.context.measureText(options[i]);
            const wx = textMetrics.width + space;
            buttons.push(new BrowserRectangle(region.wx / 2 - wx / 2, i * (textMetrics.emHeightDescent + space) + space, wx, textMetrics.emHeightDescent, { font: font, text: options[i] }));
        }
        buttons.push(new BrowserRectangle(region.x + region.wx - exitButtonSize - 5, 5, exitButtonSize, exitButtonSize, { text: "X", font: "4px Sans-serif" }));

        return [buttons, region];
    }

    public constructor(previous: BrowserState) {
        super(0, 0, 0, 0, 0.4);
        this._previous = previous;
        this._background = new BrowserFramebuffer(1, 1);

        // pascal case is when every letter is capitalized, like the class names and enum names in the project.
        // Ironically, the variable name is camelCase, not PascalCase.
        const pascalCase = Object.keys(BrowserShortcut);
        for (let i = 0; i < pascalCase.length; i++) {
            for (let j = pascalCase[i].length - 1; j > 0; j--) { // skip first character, always uppercase
                if (pascalCase[i][j] == pascalCase[i][j].toUpperCase())
                    pascalCase[i] = pascalCase[i].slice(0, j) + ' ' + pascalCase[i].slice(j);
            }
        }
        let region;
        [this._buttons, region] = this.createInterface(pascalCase);
        this.x = region.x;
        this.y = region.y;
        this.wx = region.wx;
        this.wy = region.wy;
    }

    public hasQueuedState(): boolean {
        return this._userExited;
    }

    public popQueuedState(): BrowserState | undefined {
        return this._previous;
    }

    public handleMouseClick(x: number, y: number): void {
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
    private _text: BrowserRectangle;
    private _nextState: BrowserState | undefined;

    public constructor(promise: Promise<BrowserState>, prevState: BrowserState, text: string = "Waiting...") {
        const factory = new BrowserUIFactory();
        const textRect = factory.addText(new BrowserRectangle(0, 0, 0, 0, { font: "32px Sans-serif", text: text }), BrowserUIPlace.Middle);
        super(factory.region.x, factory.region.y, factory.region.wx, factory.region.wy, 0.1);
        this._text = textRect;
        this._promise = promise;
        this._prevState = prevState;

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

    public handleMouseClick(x: number, y: number): void {

    }

    public handleKeyClick(input: string): void {
        if (input === "Escape") { // TO DO: alert the previous state/promise that this happened?
            console.log("User prompted for loading state to fall back!");
            this._nextState = this._prevState;
        }
    }

    public render(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, delta: number): void {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        this._text.render(ctx, delta);
    }
}