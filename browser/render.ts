//
//  browser/render.ts ~ RL
//
//  UI renderer
//

import { WordleCharacter, WordleCharacterState } from "../wordle.js";

export abstract class BrowserRenderTarget {
    public id: number = 0;
    public abstract render(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, delta: number): void;
}

export abstract class BrowserRenderAnimation extends BrowserRenderTarget {
    private _percent: number = 0.0;
    private _isDone: boolean = false;
    public abstract get duration(): number; 

    public get isWord(): boolean {
        return true;
    }

    public get renderMessageDuring(): boolean {
        return true;
    }

    public get percent(): number {
        return this._percent;
    }

    public set percent(value: number) {
        if (value > 1.0)
            this._isDone = true;
        this._percent = Math.min(Math.max(0.0, value), 1.0);
    }

    public get elapsed(): number {
        return this._percent * this.duration;
    }

    public set elapsed(value: number) {
        this._percent = value / this.duration;
    }

    public isDone(): boolean {
        return this._isDone;
    }
}

export class BrowserCharAnimation extends BrowserRenderAnimation {
    public get duration(): number {
        return 0.5;
    }

    public get isWord(): boolean {
        return false;
    }

    public rectangle: BrowserRectangle;
    public expandTo: number;

    public constructor(rectangle: BrowserRectangle, expandTo: number, id: number = 0) {
        super();
        this.rectangle = rectangle;
        this.expandTo = expandTo;
        this.id = id;
    }

    public render(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, delta: number): void {
        this.percent += delta / this.duration;
        const w = this.expandTo / 2 * (1.0 - Math.min(1.0, this.percent));

        ctx.fillStyle = this.rectangle.style;
        ctx.fillRect(this.rectangle.x - w / 2, this.rectangle.y - w / 2, this.rectangle.wx + w, this.rectangle.wy + w);
        ctx.fillStyle = "black";
        ctx.font = this.rectangle.font;
        ctx.fillText(this.rectangle.text.toUpperCase(), this.rectangle.x + this.rectangle.wx / 2, this.rectangle.y + this.rectangle.wy / 2);
        ctx.strokeRect(this.rectangle.x - w / 2, this.rectangle.y - w / 2, this.rectangle.wx + w, this.rectangle.wy + w);
    }
}

export class BrowserFramebuffer {
    private _width: number;
    private _height: number;
    private _memoryCanvas: OffscreenCanvas;
    private _memoryContext: OffscreenCanvasRenderingContext2D;

    public get width(): number {
        return this._width;
    }

    public get height(): number {
        return this._height;
    }

    public set width(value: number) {
        this._width = value;
        [this._memoryCanvas, this._memoryContext] = this.invalidateMemoryContext(this._memoryContext.getTransform());
    }

    public set height(value: number) {
        this._height = value;
        [this._memoryCanvas, this._memoryContext] = this.invalidateMemoryContext(this._memoryContext.getTransform());
    }

    public resize(width: number, height: number): void {
        this._width = width;
        this._height = height;
        [this._memoryCanvas, this._memoryContext] = this.invalidateMemoryContext(this._memoryContext.getTransform());
    }

    public get canvas(): OffscreenCanvas {
        return this._memoryCanvas;
    }

    public get context(): OffscreenCanvasRenderingContext2D {
        return this._memoryContext;
    }

    private scaleOfTransform(transform: DOMMatrix): [number, number] {
        return [Math.sqrt(transform.a * transform.a + transform.b * transform.b), Math.sqrt(transform.c * transform.c + transform.d * transform.d)];
    }

    private invalidateMemoryContext(transform: DOMMatrix): [OffscreenCanvas, OffscreenCanvasRenderingContext2D] {
        const w = this.scaleOfTransform(transform);
        const canvas = new OffscreenCanvas(this._width * w[0], this._height * w[1]);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            throw new Error("Failed to create memory context.");
        }
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.scale(w[0], w[1]);
        return [canvas, ctx];
    }

    public constructor(width: number, height: number) {
        this._width = width;
        this._height = height;
        [this._memoryCanvas, this._memoryContext] = this.invalidateMemoryContext(new DOMMatrix([1, 0, 0, 1, 0, 0]));
    }

    /**
     *  Transforms framebuffer to matrix, potentially destroying the old and creating a larger/smaller one in the process.
     *  @param matrix The matrix to transform the framebuffer by; this is checked with the current matrix before resizing to see if it's necessary.
     *  @returns True on new, resized framebuffer; false on nothing changing.
     */
    public transform(matrix: DOMMatrix): boolean {
        const needsNew = this.scaleOfTransform(matrix) !== this.scaleOfTransform(this._memoryContext.getTransform());
        if (needsNew)
            [this._memoryCanvas, this._memoryContext] = this.invalidateMemoryContext(matrix);
        return needsNew;
    }
}

export class BrowserWordAnimation extends BrowserRenderAnimation {
    public get duration(): number {
        return 1.5;
    }

    public get renderMessageDuring(): boolean {
        return false;
    }

    public get charDuration(): number {
        return this.duration / this.currentWord.length;
    }

    public get charPercent(): number {
        return this.percent % (1 / this.currentWord.length) * this.currentWord.length;
    }

    public set charPercent(value: number) {
        this.percent -= (this.charPercent + value) / this.currentWord.length;
    }

    public get index(): number {
        return Math.floor(this.percent * this.currentWord.length);
    }

    public set index(value: number) {
        this.percent = value / this.currentWord.length;
    }

    public currentWord: Array<BrowserRectangle>;
    public targetWord: Array<BrowserRectangle>;
    private _offscreen: BrowserFramebuffer;

    public constructor(prevWord: Array<BrowserRectangle>, currWord: Array<BrowserRectangle>, id: number = 0) {
        super();
        if (prevWord.length !== currWord.length)
            throw new Error("Words passed to BrowserWordAnimation are not compatible.");
        this.currentWord = prevWord;
        this.targetWord = currWord;
        this._offscreen = new BrowserFramebuffer(prevWord[0].wx, prevWord[0].wy);
        this.id = id;
    }

    public render(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, delta: number): void {
        this._offscreen.transform(ctx.getTransform());
        this._offscreen.context.font = ctx.font;
        for (let i = 0; i < this.currentWord.length; i++) {
            let w = 0;
            if (this.index === i) {
                this.percent += delta / this.duration;
                w = this.index !== i ? this.currentWord[i].wy : this.charPercent * this.currentWord[i].wy;
                if (this.charPercent > 0.5) {
                    this.currentWord[i] = this.targetWord[i];
                }
            }
            ctx.fillStyle = this.currentWord[i].style;
            ctx.fillRect(this.currentWord[i].x, this.currentWord[i].y + w, this.currentWord[i].wx, this.currentWord[i].wy - w * 2);
            ctx.strokeStyle = this.currentWord[i].strokeStyle;
            ctx.strokeRect(this.currentWord[i].x, this.currentWord[i].y + w, this.currentWord[i].wx, this.currentWord[i].wy - w * 2);

            this._offscreen.context.clearRect(0, 0, this._offscreen.canvas.width, this._offscreen.canvas.height);
            this._offscreen.context.fillStyle = this.currentWord[i].fontStyle;
            this._offscreen.context.font = this.currentWord[i].font;
            this._offscreen.context.fillText(this.currentWord[i].text, this.currentWord[i].wx / 2, this.currentWord[i].wy / 2);

            ctx.drawImage(this._offscreen.canvas, this.currentWord[i].x, this.currentWord[i].y + w, this.currentWord[i].wx, this.currentWord[i].wy - w * 2);
        }
    }
}

export class BrowserShakeAnimation extends BrowserRenderAnimation {
    public get frequency(): number {
        return 3;
    }

    public get height(): number {
        return 5;
    }

    public get duration(): number {
        return 0.3;
    }

    public rects: Array<BrowserRectangle>;

    public constructor(rects: Array<BrowserRectangle>, id: number = 0) {
        super();
        this.rects = rects;
        this.id = id;
    }

    public render(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, delta: number): void {
        this.percent += delta / this.duration;
        const x = this.percent * this.frequency * this.frequency + this.frequency / 4;
        const value = (2 * this.height * Math.abs(x % this.frequency * 2 - this.frequency) - this.frequency * this.height) / (2 * this.frequency);
        for (let i = 0; i < this.rects.length; i++) {
            ctx.fillStyle = this.rects[i].style;
            ctx.fillRect(this.rects[i].x + value, this.rects[i].y, this.rects[i].wx, this.rects[i].wy);
            ctx.fillStyle = this.rects[i].fontStyle;
            ctx.font = this.rects[i].font;
            ctx.fillText(this.rects[i].text, this.rects[i].x + this.rects[i].wx / 2 + value, this.rects[i].y + this.rects[i].wy / 2);
            ctx.strokeRect(this.rects[i].x + value, this.rects[i].y, this.rects[i].wx, this.rects[i].wy);
        }
    }
}

export class BrowserWinAnimation extends BrowserRenderAnimation {
    public get duration(): number {
        return 1.3;
    }

    public rects: Array<BrowserRectangle>;
    public constructor(rects: Array<BrowserRectangle>, id: number = 0) {
        super();
        this.rects = rects;
        this.id = id;
    }

    private cubicBezierUp(x0: number, y0: number, x1: number, y1: number, percent: number): [number, number] {
        const bezier = (p0: number, p1: number): number => {
            return percent * p0 * (3 * (1 - percent) ** 2) + p1 * (3 * (1 - percent) * percent ** 2) + percent ** 3;
        }
        return [bezier(x0, x1), bezier(y0, y1)];
    }

    private cubicBezierDown(x0: number, y0: number, x1: number, y1: number, percent: number): [number, number] {
        const bezier = (p0: number, p1: number): number => {
            return percent * p0 * (3 * (1 - percent) ** 2) + p1 * (3 * (1 - percent) * percent ** 2) + (1 - percent) ** 3;
        }
        return [bezier(x0, x1), bezier(y0, y1)];
    }

    private between(lower: number, upper: number, percent: number): boolean {
        return lower < percent && upper >= percent;
    }

    // @ts-ignore
    private animateY(percent: number): number {
        if (!this.between(0.0, 1.0, percent)) {
            throw new Error("Percent is not between 0% and 100%.");
        }
        // Credit: https://github.com/animate-css/animate.css/blob/main/animate.css
        if (this.between(0.0, 0.2, percent)) {
            return 0.0;
        }
        else if (this.between(0.2, 0.4, percent)) {
            let convPercent = (0.4 - percent) / 0.2;
            return this.cubicBezierDown(0.215, 0.61, 0.355, 1, convPercent)[1] * -33;
        }
        else if (this.between(0.4, 0.43, percent)) {
            return -33;
        }
        else if (this.between(0.43, 0.53, percent)) {
            let convPercent = (0.53 - percent) / 0.1;
            return this.cubicBezierUp(0.755, 0.05, 0.855, 0.06, convPercent)[1] * -33;
        }
        else if (this.between(0.53, 0.7, percent)) {
            let convPercent = (0.7 - percent) / 0.17;
            return this.cubicBezierDown(0.215, 0.61, 0.355, 1, convPercent)[1] * -15.75;
        }
        else if (this.between(0.7, 0.8, percent)) {
            let convPercent = (0.8 - percent) / 0.1;
            return this.cubicBezierUp(0.755, 0.05, 0.855, 0.06, convPercent)[1] * -15.75;
        }
        else if (this.between(0.8, 0.9, percent)) {
            let convPercent = (0.9 - percent) / 0.1;
            return this.cubicBezierDown(0.25, 0.1, 0.25, 1.0, convPercent)[1] * -4.08;
        }
        else if (this.between(0.9, 1.0, percent)) {
            let convPercent = (1.0 - percent) / 0.1;
            return this.cubicBezierUp(0.25, 0.1, 0.25, 1.0, convPercent)[1] * -4.08;
        }
    }

    public render(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, delta: number): void {
        this.percent += delta / this.duration;
        const timeBetweenLetterJumps = 0.5 * this.duration / this.rects.length;
        for (let i = 0; i < this.rects.length; i++) {
            const ithStartTime = timeBetweenLetterJumps * i;
            if (ithStartTime < this.elapsed) {
                const y = this.animateY((this.elapsed - ithStartTime) / (this.duration - ithStartTime));
                ctx.fillStyle = this.rects[i].style;
                ctx.fillRect(this.rects[i].x, this.rects[i].y + y, this.rects[i].wx, this.rects[i].wy);
                ctx.fillStyle = this.rects[i].fontStyle;
                ctx.font = this.rects[i].font;
                ctx.fillText(this.rects[i].text, this.rects[i].x + this.rects[i].wx / 2, this.rects[i].y + this.rects[i].wy / 2 + y);
                ctx.strokeRect(this.rects[i].x, this.rects[i].y + y, this.rects[i].wx, this.rects[i].wy);
            }
            else
                this.rects[i].render(ctx, delta);
        }
    }
}

export class BrowserRectangle extends BrowserRenderTarget {
    public x: number;
    public y: number;
    public wx: number;
    public wy: number;
    public text: string;

    public font: string;
    public fontStyle: string;
    public styleList: Array<string>;
    public radii: number;
    public strokeStyle: string;
    public strokeWidth: number;

    private _currentStyle: string = "";

    public constructor(x: number, y: number, wx: number, wy: number, attribs: {
        text?: string, font?: string, styleList?: Array<string>, style?: string, fontStyle?: string, radii?: number, strokeStyle?: string, strokeWidth?: number
    } = {}) {
        super();

        this.x = x;
        this.y = y;
        this.wx = wx;
        this.wy = wy;

        this.text = attribs.text ?? "";
        this.font = attribs.font ?? "14px Sans-Serif";
        this.fontStyle = attribs.fontStyle ?? "black";
        this.styleList = attribs.styleList ?? ["white"];
        this.style = attribs.style ?? this.styleList[0];
        this.radii = attribs.radii ?? 0;
        this.strokeStyle = attribs.strokeStyle ?? "";
        this.strokeWidth = attribs.strokeWidth ?? 0;
    }

    public render(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, delta: number): void {
        ctx.fillStyle = this.style;
        ctx.strokeStyle = this.strokeStyle;
        ctx.lineWidth = this.strokeWidth;
        if (this.radii) {
            ctx.beginPath();
            ctx.roundRect(this.x, this.y, this.wx, this.wy, this.radii);
            if (this.strokeWidth)
                ctx.stroke();
            ctx.fill();
        }
        else {
            ctx.fillRect(this.x, this.y, this.wx, this.wy);
            if (this.strokeWidth)
                ctx.strokeRect(this.x, this.y, this.wx, this.wy);
        }
        ctx.fillStyle = this.fontStyle;
        ctx.font = this.font;
        ctx.fillText(this.text, this.x + this.wx / 2, this.y + this.wy / 2);
    }

    public get style(): string {
        return this._currentStyle;
    }

    public set style(value: string) {
        if (this.styleList.includes(value))
            this._currentStyle = value;
        else {
            this.styleList.push(value);
            this._currentStyle = value;
        }
    }

    public get left(): number {
        return this.x;
    }

    public get right(): number {
        return this.x + this.wx;
    }

    public get top(): number {
        return this.y;
    }

    public get bottom(): number {
        return this.y + this.wy;
    }

    public set left(value: number) {
        this.x = value;
    }

    public set right(value: number) {
        this.wx = value - this.x;
    }

    public set top(value: number) {
        this.y = value;
    }

    public set bottom(value: number) {
        this.wy = value - this.y;
    }

    public get region(): BrowserRegion {
        return new BrowserRegion(this.x, this.y, this.wx, this.wy);
    }

    public isPointInRectangle(x: number, y: number): boolean {
        return this.left < x && this.top < y && this.right > x && this.bottom > y
    }
}

// TO DO: replace with BrowserRectangle
export class BrowserRegion {
    public x: number;
    public y: number;
    public wx: number;
    public wy: number;

    public static fromAbsolutePositions(left: number, top: number, right: number, bottom: number): BrowserRegion {
        return new BrowserRegion(left, top, right - left, bottom - top);
    }

    public static fromRelativePositions(x: number, y: number, wx: number, wy: number): BrowserRegion {
        return new BrowserRegion(x, y, wx, wy);
    }

    public static fromRectangles(...rects: BrowserRectangle[]): BrowserRegion {
        const result = new BrowserRegion(rects[0].x, rects[0].y, rects[0].wx, rects[0].wy);
        rects.forEach(v => {
            if (v.left < result.left)
                result.left = v.left;
            if (v.top < result.top)
                result.top = v.top;
            if (v.right > result.right)
                result.right = v.right;
            if (v.bottom > result.bottom)
                result.bottom = v.bottom;
        });
        return result;
    }

    public constructor(x: number, y: number, wx: number, wy: number) {
        this.x = x;
        this.y = y;
        this.wx = wx;
        this.wy = wy;
    }

    public get left(): number {
        return this.x;
    }

    public get right(): number {
        return this.x + this.wx;
    }

    public get top(): number {
        return this.y;
    }

    public get bottom(): number {
        return this.y + this.wy;
    }

    public set left(value: number) {
        this.wx -= value - this.x;
        this.x = value;
    }

    public set right(value: number) {
        this.wx = value - this.x;
    }

    public set top(value: number) {
        this.wy -= value - this.y;
        this.y = value;
    }

    public set bottom(value: number) {
        this.wy = value - this.y;
    }

    public merge(other: BrowserRegion): BrowserRegion {
        return BrowserRegion.fromAbsolutePositions(Math.min(this.left, other.left), Math.min(this.top, other.top), Math.max(this.right, other.right), Math.max(this.bottom, other.bottom));
    }

    public centerRegion(wx: number, wy: number, percent: number = 0.9): BrowserRegion {
        const x = (wx - wx * percent) / 2;
        const y = (wy - wy * percent) / 2;
        wx *= percent;
        wy *= percent;
        const ratio = Math.min(wx / this.wx, wy / this.wy);
        const pair = [this.wx * ratio, this.wy * ratio];
        const result = new BrowserRegion(x + wx / 2 - pair[0] / 2, y + wy / 2 - pair[1] / 2, pair[0], pair[1]);
        return result;
    }

    public transform(mat: DOMMatrix): BrowserRegion {
        let leftTop = mat.transformPoint(new DOMPoint(this.left, this.top)),
            rightBottom = mat.transformPoint(new DOMPoint(this.right, this.bottom));

        return BrowserRegion.fromAbsolutePositions(leftTop.x, leftTop.y, rightBottom.x, rightBottom.y);
    }
}

// TO DO: remove entirely
export class BrowserUIFactory {
    private _fontMeasurer: BrowserFramebuffer;

    public constructor() {
        this._fontMeasurer = new BrowserFramebuffer(1, 1);
        this._fontMeasurer.context.textBaseline = "top";
    }

    /**
     * Measures str's width and height in font.
     * @param font Font to measure in
     * @param str String to measure
     * @returns An array of numbers; index 0 is width, index 1 is height.
     */
    public measureText(font: string, str: string): [number, number] {
        this._fontMeasurer.context.font = font;
        const textMetrics = this._fontMeasurer.context.measureText(str);
        return [textMetrics.width, textMetrics.emHeightDescent];
    }

    public createTransform(from: BrowserRegion, to: BrowserRegion): DOMMatrix {
        const dax = from.right - from.left, dbx = to.right - to.left;
        const day = from.bottom - from.top, dby = to.bottom - to.top;
        return new DOMMatrix([dbx / dax, 0, 0, dby / day, -from.left * dbx / dax + to.left, -from.top * dby / day + to.top]);
    }
}

/**
 * Represents both the UI component of a keyboard and the functionality.
 */
export class BrowserKeyboard extends BrowserRenderTarget {
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

    private createInterface(): [Array<BrowserRectangle>, BrowserRegion] {
        const rows = [
            ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
            ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
            ['z', 'x', 'c', 'v', 'b', 'n', 'm'], []];
        const width = 30, height = 50, space = 5, style: any = { font: "24px Sans-serif", styleList: ["Gainsboro", "DarkGray", "Yellow", "Green"] };
        const result = new Array<BrowserRectangle>();
        const center = (rows[0].length * (width + space) - space) / 2;

        for (let r = 0; r < 3; r++) {
            let startX = center - (rows[r].length * (width + space) - space) / 2;
            for (let c = 0; c < rows[r].length; c++)
                result.push(new BrowserRectangle(c * (width + space) + startX, r * (height + space), width, height, { text: rows[r][c], ...style }));
        }

        const bottomY = (height + space) * 2,
            bottomRight = result[result.length - 1].right + space,
            bottomLeft = result[result.length - rows[2].length].left;
        result.push(new BrowserRectangle(bottomRight, bottomY, result[rows[0].length - 1].right - bottomRight, height, { text: "\u232B", ...style }));
        style.font = "14px Sans-serif";
        result.push(new BrowserRectangle(0, bottomY, bottomLeft - space, height, { text: "ENTER", ...style }));

        return [result, BrowserRegion.fromRectangles(...result)];
    }

    public constructor(x: number, y: number) {
        super();

        [this._keys, this._keysRegion] = this.createInterface();
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

    private createInterface(): [Array<BrowserRectangle>, BrowserRegion] {
        const size = 50, space = 10, colors = ["white", "Gainsboro", "yellow", "green"];

        const result: Array<BrowserRectangle> = [];
        let region = new BrowserRegion(0, 0, (size + space) * this._charCount - space, (size + space) * this._wordCount - space);
        for (let i = 0; i < this._wordCount; i++) {
            for (let j = 0; j < this._charCount; j++)
                result.push(new BrowserRectangle(j * (size + space), i * (size + space), size, size, { strokeStyle: "gray", strokeWidth: 1, text: ' ', font: "bold 36px Sans-serif", styleList: colors }));
        }

        return [result, region];
    }

    public constructor(x: number, y: number, wordCount: number, charCount: number) {
        super();
        this._wordCount = wordCount;
        this._charCount = charCount;
        [this._cells, this._cellsRegion] = this.createInterface();
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
        const previous: Array<BrowserRectangle> = [];
        let allGreen = true, allComplete = true;
        for (let i = 0; i < word.length; i++) {
            const cell = this._cells[wordIndex * this._charCount + i];
            // deep copies
            previous[i] = new BrowserRectangle(cell.x, cell.y, cell.wx, cell.wy);
            previous[i].font = (' ' + cell.font).slice(1);
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