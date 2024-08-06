//
//  browser/browser.ts ~ RL
//
//  Browser backend for Wordle Coop
//

import { CoopClient } from "../coop.js";
import { WordleCharacter, WordleCharacterState, WordleGame } from "../wordle.js";
import { WordListManager } from "../wordList.js";
import { BrowserCharAnimation, BrowserFramebuffer, BrowserRectangle, BrowserRegion, BrowserRenderAnimation, BrowserRenderTarget, BrowserShakeAnimation, BrowserUIFactory, BrowserWinAnimation, BrowserWordAnimation } from "./render.js";

export interface BrowserMouseUserInterface {
    handleMouseClick(x: number, y: number): void;
}

// There is no "BrowserKeyUserInterface" because this application is streamlined for users on mobile.

export abstract class BrowserState extends BrowserRenderTarget implements BrowserMouseUserInterface {
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
 * Represents both the UI component of a keyboard and the functionality.
 */
export class BrowserKeyboard extends BrowserRenderTarget implements BrowserMouseUserInterface {
    private _keys: Array<BrowserRectangle>;
    private _image: BrowserFramebuffer;
    private _needsInvalidate: boolean;

    private _keysRegion: BrowserRegion;
    private _adjRegion: BrowserRegion;
    private _transform: DOMMatrix;

    private _currentKey: string = "";

    public get region(): BrowserRegion {
        return this._adjRegion;
    }

    public set region(value: BrowserRegion) {
        this._adjRegion = value;
        this._transform = new BrowserUIFactory().createTransform(this._keysRegion, this._adjRegion);
        this._needsInvalidate = true;
    }

    public constructor(x: number, y: number) {
        super();
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

        this._currentKey = "";
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

    public handleKeyClick(char: string): void {
        if ("abcdefghijklmnopqrstuvwxyz".includes(char.toLowerCase()) || char === "Backspace" || char == "Enter")
            this._currentKey = char;
    }

    public handleMouseClick(x: number, y: number): void {
        const pt = this._transform.inverse().transformPoint(new DOMPoint(x, y));
        for (let i = 0; i < this._keys.length; i++) {
            if (this._keys[i].isPointInRectangle(pt.x, pt.y))
                this._currentKey = this._keys[i].text === "\u232B" ? "Backspace" : this._keys[i].text;
        }
    }

    public getCurrentKey(): string {
        return this._currentKey;
    }
}

/**
 * Represents the game's character board and its UI
 */
export class BrowserWordleBoard extends BrowserRenderTarget {
    private _image: BrowserFramebuffer;
    private _needsInvalidate: boolean;

    private _cells: Array<BrowserRectangle>;
    private _animations: Array<BrowserCharAnimation>;
    private _wordQueue: Array<BrowserRenderAnimation>;

    private _cellsRegion: BrowserRegion;
    private _adjRegion: BrowserRegion;
    private _transform: DOMMatrix;

    private _charCount: number;
    private _wordCount: number;
    public addAnimations: boolean = true;

    public get region(): BrowserRegion {
        return this._adjRegion;
    }

    public set region(value: BrowserRegion) {
        this._adjRegion = value;
        this._transform = new BrowserUIFactory().createTransform(this._cellsRegion, this._adjRegion);
    }

    /**
     * Gets current word animation. If there is no word animation, it returns a completed BrowserCharAnimation.
     */
    public get wordAnimation(): BrowserRenderAnimation {
        const blank = new BrowserCharAnimation(this._cells[0], 0, 0);
        blank.percent = 1.1;
        return this._wordQueue.length <= 0 ? blank : this._wordQueue[0];
    }

    public constructor(x: number, y: number, wordCount: number, charCount: number) {
        super();
        this._wordCount = wordCount;
        this._charCount = charCount;
        [this._cells, this._cellsRegion] = new BrowserUIFactory().createCells(this._wordCount, this._charCount);
        this._animations = [];
        this._wordQueue = [];
        this._image = new BrowserFramebuffer(1, 1);
        this._needsInvalidate = true;

        this._transform = new DOMMatrix([1, 0, 0, 1, 0, 0]).translate(x, y);
        this._adjRegion = this._cellsRegion.transform(this._transform);
    }

    /**
     * Sets character at (wordIndex, charIndex) to char and color.
     * This does not play an animation if the flag "addAnimations" is set to false or the char is a space character.
     * @param wordIndex Word index of character
     * @param charIndex Character index of character
     * @param char The one-letter, alphabetic character to use. This is converted to uppercase when displayed.
     * @param color The color/state of the cell.
     */
    public setCharacter(wordIndex: number, charIndex: number, char: string, color: WordleCharacterState = WordleCharacterState.Unknown): void {
        char = char.toUpperCase();
        if (char.length !== 1 || !"ABCDEFGHIJKLMNOPQRSTUVWXYZ ".includes(char))
            throw new Error("String passed does not have a length of one or is not part of the alphabet, or is not a space character.");
        if (wordIndex < 0 || wordIndex >= this._wordCount || charIndex < 0 || charIndex >= this._charCount)
            return;

        const cellIndex = wordIndex * this._charCount + charIndex;
        this._cells[cellIndex].text = char;
        this._cells[cellIndex].style = this._cells[cellIndex].styleList[color];

        if (!this.addAnimations || char === ' ')
            return;
        const previousIndex = this._animations.findIndex(v => v.id === cellIndex);
        const anim = new BrowserCharAnimation(this._cells[cellIndex], 5, cellIndex);
        if (previousIndex === -1)
            this._animations.push(anim);
        else
            this._animations[previousIndex] = anim;
    }

    /**
     * Sets word at wordIndex to word. If the "addAnimations" flag is true, it will do the following:
     *     If all characters are colored and are filled in, the word will display a flip animation. Otherwise, it will shake.
     *     If all colored parts of the word are green, it will create a win animation after on those cells.
     * @param wordIndex The index of the word on the board. This dictates where it will be displayed
     * @param word The completed, colored word
     */
    public setWord(wordIndex: number, word: WordleCharacter[]): void {
        if (word.length !== this._charCount)
            throw new Error("Word passed does not match the length of the board.");
        const previous = new BrowserUIFactory().createWord(this._charCount, 0, this._cells[wordIndex * this._charCount].y)[0];
        let allGreen = true, allComplete = true;
        for (let i = 0; i < word.length; i++) {
            const cell = this._cells[wordIndex * this._charCount + i];

            // deep copies
            previous[i].text = (' ' + cell.text).slice(1);
            previous[i].style = (' ' + cell.style).slice(1);

            cell.text = word[i].character.toUpperCase();
            cell.style = cell.styleList[word[i].state];

            allGreen = allGreen && word[i].state === WordleCharacterState.Green;
            allComplete = allComplete && word[i].character !== ' ' && word[i].state !== WordleCharacterState.Unknown;
        }
        const region = this._cells.slice(wordIndex * this._charCount, wordIndex * this._charCount + this._charCount);
        if (this.addAnimations && allComplete) {
            this._animations = this._animations.filter(v => v.id < wordIndex * this._charCount || v.id >= wordIndex * this._charCount + this._charCount);
            this._wordQueue.push(new BrowserWordAnimation(previous, region, wordIndex));
            if (allGreen)
                this._wordQueue.push(new BrowserWinAnimation(region, wordIndex));
        }
        else if (this.addAnimations) {
            this._animations = this._animations.filter(v => v.id < wordIndex * this._charCount || v.id >= wordIndex * this._charCount + this._charCount);
            this._wordQueue.push(new BrowserShakeAnimation(region, wordIndex));
        }
    }

    /**
     * Renders game board to ctx, using delta parameter
     * @param ctx Canvas to render to. Transform in use prior is conserved.
     * @param delta Time in milliseconds since the last render
     */
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
            this._image.context.textAlign = "center";
            this._image.context.textBaseline = "middle";
            for (let i = 0; i < this._cells.length; i++) {
                let animationIndex = this._animations.findIndex(v => v.id === i);
                if (this._wordQueue.length !== 0 && Math.floor(i / this._charCount) === this._wordQueue[0].id) {
                    this._wordQueue[0].render(this._image.context, delta);
                    i += this._charCount - 1;
                    if (this._wordQueue[0].isDone())
                        this._wordQueue.splice(0, 1);
                }
                else if (animationIndex !== -1) {
                    this._animations[animationIndex].render(this._image.context, delta);
                    if (this._animations[animationIndex].isDone())
                        this._animations.splice(animationIndex, 1);
                }
                else
                    this._cells[i].render(this._image.context, delta);
            }
            this._image.context.setTransform(mat4);
            this._needsInvalidate = this._wordQueue.length !== 0 || this._animations.length !== 0;
        }
        ctx.setTransform();
        ctx.drawImage(this._image.canvas, 0, 0);
        ctx.setTransform(mat4);
    }
}

export abstract class BrowserGameState extends BrowserState {
    protected transform: DOMMatrix;
    protected keyboard: BrowserKeyboard;
    protected board: BrowserWordleBoard;
    protected game: WordleGame;
    protected menuButton: BrowserRectangle;
    protected message: string = "";
    protected messagePos: number;

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

    public constructor() {
        super();
        this.game = new WordleGame();

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
        if (input.toUpperCase() === input && Object.values(BrowserShortcut).includes(input as BrowserShortcut))
            this.shortcut(input as BrowserShortcut);
        else
            this.keyboard.handleKeyClick(input);
    }

    protected abstract update(): void;
    protected abstract shortcut(shortcut: BrowserShortcut): void;

    public render(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, delta: number): void {
        this.update();

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
            ctx.fillText("Guided mode -- Shift+T to toggle", 0, this.board.region.bottom + 4);
        }
    }
}

export class BrowserSingleplayerState extends BrowserGameState {
    private _changeUiAt: number = -1;
    protected shortcut(key: BrowserShortcut) {
        switch (key) {
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
                this._changeUiAt = this.game.board.currentWordIndex;
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

    protected update(): void {
        const key = this.keyboard.getCurrentKey();
        if (key !== "" && this.board.wordAnimation.isDone()) {
            if (this.game.startQueuedGame())
                this.createInterface();
            this._changeUiAt = this.game.board.currentWordIndex;
            if (key === "Enter") {
                const start = this.game.board.currentWordIndex;
                this.game.onPushWord();
                this.board.setWord(start, this.game.board.data[start].word);
            }
            else if (key === "Backspace") {
                this.game.onPopCharacter();
                this.board.setCharacter(this.game.board.currentWordIndex, this.game.board.currentCharacterIndex, ' ');
            }
            else {
                const charPos = this.game.board.currentCharacterIndex;
                if (this.game.onPushCharacter(key))
                    this.board.setCharacter(this.game.board.currentWordIndex, charPos, key);
            }
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

export class BrowserCoopState extends BrowserGameState {
    private _connection: CoopClient;
    private _changeUiAt: number = -1;

    private onClose(): void {
        alert("Connection closed, moving to a singleplayer state.");
        this.nextState = new BrowserSingleplayerState();
    }

    public constructor(connection: CoopClient) {
        super();
        this._connection = connection;
        console.log(`Connected to session: ${connection.sessionId}. Sending protocol now.`);

        this._connection
            .addTwoWayProtocol("PushChar", "", this.physPushChar.bind(this))
            .addTwoWayProtocol("PopChar", "", this.physPopChar.bind(this))
            .addTwoWayProtocol("PushWord", "", this.physPushWord.bind(this))
            .finishProtocol();
        this._connection.onClose = this.onClose;
    }

    private physPushChar(char: string): void {
        this._changeUiAt = this.game.board.currentWordIndex;
        const charPos = this.game.board.currentCharacterIndex;
        if (this.game.onPushCharacter(char))
            this.board.setCharacter(this.game.board.currentWordIndex, charPos, char);
    }

    private physPopChar(): void {
        this._changeUiAt = this.game.board.currentWordIndex;
        this.game.onPopCharacter();
        this.board.setCharacter(this.game.board.currentWordIndex, this.game.board.currentCharacterIndex, ' ');
    }

    private physPushWord(): void {
        this._changeUiAt = this.game.board.currentWordIndex;
        const start = this.game.board.currentWordIndex;
        this.game.onPushWord();
        this.board.setWord(start, this.game.board.data[start].word);
    }

    protected update(): void {
        const key = this.keyboard.getCurrentKey();
        if (key !== "" && this.board.wordAnimation.isDone()) {
            if (this.game.startQueuedGame())
                this.createInterface();
            if (key === "Enter") {
                this.physPushWord();
                this._connection.sendMessage("PushWord", this.game.board.data[this._changeUiAt].join());
            }
            else if (key === "Backspace") {
                this.physPopChar();
                this._connection.sendMessage("PopChar", this.game.board.data[this._changeUiAt].join());
            }
            else {
                this.physPushChar(key);
                this._connection.sendMessage("PushChar", key);
            }
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
    }

    protected shortcut(shortcut: BrowserShortcut): void {
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