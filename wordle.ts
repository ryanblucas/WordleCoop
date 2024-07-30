//
//  wordle.ts ~ RL
//
//  Wordle game logic
//

import { WordList, WordListManager } from "./wordList.js";

export enum WordleCharacterState {
    Unknown,
    Black,
    Yellow,
    Green
}

export class WordleCharacter {
    private _character: string;
    public state: WordleCharacterState;

    public get character(): string {
        return this._character;
    }

    public set character(value: string) {
        if (value.length !== 1)
            throw new Error("Value provided must be a character.");

        this._character = value.toLowerCase();
    }

    public constructor(character: string, state: WordleCharacterState) {
        if (character.length !== 1)
            throw new Error("Character provided is not valid.");

        this._character = character.toLowerCase();
        this.state = state;
    }
}

export class WordleWord {
    public word: Array<WordleCharacter>;

    public constructor(length: number) {
        this.word = new Array<WordleCharacter>(length);
        this.word.fill(new WordleCharacter(' ', WordleCharacterState.Unknown));
    }

    public copy(): WordleWord {
        let result = new WordleWord(this.word.length);
        result.word = this.word.map(char => new WordleCharacter(char.character, char.state));
        return result;
    }

    public isFull(): boolean {
        for (let i = 0; i < this.word.length; i++) {
            if (this.word[i].character === ' ')
                return false;
        }
        return true;
    }

    public set(word: string) {
        if (word.length !== this.word.length)
            throw new Error("Word provided is not the proper length.");

        for (let i = 0; i < this.word.length; i++)
            this.word[i] = new WordleCharacter(word[i], WordleCharacterState.Unknown);
    }

    public join(delimiter: string = ''): string {
        let array = new Array<string>(this.word.length);
        for (let i = 0; i < this.word.length; i++)
            array[i] = this.word[i].character;
        return array.join(delimiter);
    }

    public colorWord(target: string): void {
        if (target.length !== this.word.length)
            throw new Error("Target word provided is not the proper length.");

        this.word.forEach((value) => { value.state = WordleCharacterState.Black; });

        let copy = [...this.word];
        let targetArray = target.toLowerCase().split('');
        for (let i = 0; i < this.word.length; i++) {
            if (this.word[i].character === target.charAt(i)) {
                this.word[i].state = WordleCharacterState.Green;
                targetArray.splice(i - target.length + targetArray.length, 1);
                copy.splice(i - this.word.length + copy.length, 1);
            }
        }

        for (let i = 0; i < copy.length; i++) {
            let j = targetArray.indexOf(copy[i].character)
            if (j !== -1) {
                targetArray.splice(j, 1);
                copy[i].state = WordleCharacterState.Yellow;
            }
        }
    }
}

export class WordleBoard {
    public data: Array<WordleWord>;
    private _targetWord: string;
    private _currentWord: number;
    private _currentCharacter: number;
    private _invalidLetters: Array<string>;

    public get currentWordIndex(): number {
        return this._currentWord;
    }

    public set currentWordIndex(value: number) {
        if (value < 0 || value >= this.totalWordCount)
            throw new RangeError("Current word index cannot be less than zero or greater than the total word count.");

        this._currentWord = value;
    }

    public get currentCharacterIndex(): number {
        return this._currentCharacter;
    }

    public set currentCharacterIndex(value: number) {
        if (value < 0 || value >= this.totalCharacterCount)
            throw new RangeError("Current word index cannot be less than zero or greater than the total word count.");

        this._currentCharacter = value;
    }

    public get currentWord(): WordleWord {
        return this.data[this.currentWordIndex];
    }

    public set currentWord(value: WordleWord) {
        if (value.word.length != this.totalCharacterCount)
            throw new Error("Current word must be equal to total character count.");

        this.data[this.currentWordIndex] = value;
    }

    public get currentCharacter(): WordleCharacter {
        return this.data[this.currentWordIndex].word[this.currentCharacterIndex];
    }

    public set currentCharacter(value: WordleCharacter) {
        this.data[this.currentWordIndex].word[this.currentCharacterIndex] = value;
    }

    public get totalCharacterCount(): number {
        return this.targetWord.length;
    }

    public get totalWordCount(): number {
        return this.data.length;
    }

    public set totalWordCount(value: number) {
        if (value <= this.currentWordIndex)
            throw new Error("New total word count cannot be less than current word index.");

        this.data.length = value;
    }

    public get targetWord(): string {
        return this._targetWord;
    }

    public set targetWord(value: string) {
        if (value.length != this.totalCharacterCount)
            throw new Error("New target word must be equal to the previous one's character count.");

        this._targetWord = value;
    }

    public get invalidLetters(): Array<string> {
        return this._invalidLetters;
    }

    public constructor(target: string, wordCount: number = 6) {
        if (wordCount <= 0)
            throw new RangeError("Word count must be greater than 0.");

        this._targetWord = target.toLowerCase();
        this.data = new Array<WordleWord>(wordCount);
        for (let i = 0; i < this.data.length; i++)
            this.data[i] = new WordleWord(target.length);

        this._currentWord = 0;
        this._currentCharacter = 0;
        this._invalidLetters = new Array<string>();
    }

    public pushCharacter(char: string): void {
        if (char.length != 1)
            throw new Error("Character provided is not valid.");

        this.currentCharacter = new WordleCharacter(char, WordleCharacterState.Unknown);
        if (this.currentCharacterIndex + 1 < this.totalCharacterCount)
            this.currentCharacterIndex++;
    }

    public popCharacter(): string {
        let result = ' ';

        if (this.currentCharacter.character !== ' ') {
            result = this.currentCharacter.character;
            this.currentCharacter.character = ' ';
        }
        else {
            if (this.currentCharacterIndex - 1 >= 0)
                this.currentCharacterIndex--;

            result = this.currentCharacter.character;
            this.currentCharacter.character = ' ';
        }

        return result;
    }

    public pushAndColorWord(): boolean {
        this.currentWord.colorWord(this.targetWord);
        let invalidLetters = this.currentWord.word.filter(c => c.state === WordleCharacterState.Black && !this._invalidLetters.includes(c.character) && !this.targetWord.includes(c.character));
        this._invalidLetters = this._invalidLetters.concat(invalidLetters.map(c => c.character));
        if (this.currentWordIndex + 1 >= this.totalWordCount)
            return false;

        this.currentWordIndex++;
        this.currentCharacterIndex = 0;
        return true;
    }
}

export class WordleGame {
    private _board: WordleBoard;
    private _list?: WordList;
    private _message: string = "";
    private _gaveUp: boolean = false;

    public queuedGame: WordleBoard;
    public guidedMode: boolean = false;

    public get board(): WordleBoard {
        return this._board;
    }

    public set board(value: WordleBoard) {
        this._board = value;
        this.queuedGame = value;
        this._list = WordListManager.getWordCoordinates(value.targetWord)!.list;
    }

    public constructor() {
        const word = WordListManager.getWordOfTheDay();
        const list = WordListManager.getWordCoordinates(word);
        this._board = new WordleBoard(word, list!.list.guessCount);
        this._list = list!.list;
        this.queuedGame = this.board;
    }

    public hasMessage(): boolean {
        return this._message !== "";
    }

    public popMessage(): string {
        const result = this._message;
        this._message = "";
        return result;
    }

    public startQueuedGame(): boolean {
        if (this.board === this.queuedGame)
            return false;
        this.board = this.queuedGame;
        return true;
    }

    public isWon(): boolean {
        if (this._gaveUp)
            return false;

        let previous = this.board.currentWordIndex;
        while (previous >= 0 && !this.board.data[previous].isFull()) previous--;
        if (previous < 0)
            return false;

        return this.board.data[previous].word.filter(value => value.state !== WordleCharacterState.Green).length == 0;
    }

    public isLost(): boolean {
        return this._gaveUp
            || (this.board.currentWordIndex + 1 >= this.board.totalWordCount && this.board.currentWord.word[0].state !== WordleCharacterState.Unknown);
    }

    public restart(word: string): void {
        const coords = WordListManager.getWordCoordinates(word);
        if (!coords)
            throw new Error("Word \"" + word + "\" does not exist in any word list.");
        this.board = new WordleBoard(word, coords.list.guessCount);
    }

    private changeGameState(): void {
        if (this.isWon()) {
            this._message = "You won!";
            this.queuedGame = new WordleBoard(WordListManager.getRandomWord());
        }
        else if (this.isLost()) {
            this._message = this.board.targetWord;
            this.queuedGame = new WordleBoard(WordListManager.getRandomWord());
        }
        this._gaveUp = false;
    }

    private isForGreenLetter(i: number): boolean {
        return this.board.data.findIndex(w => w.word[i].state === WordleCharacterState.Green) !== -1;
    }

    private isProperGreenLetter(i: number, c: string): boolean {
        return this.board.data.findIndex(w => w.word[i].state === WordleCharacterState.Green && w.word[i].character === c) !== -1;
    }

    private isYellowLetterInvalidForPosition(i: number, c: string): boolean {
        return this.board.data.findIndex(w => w.word[i].character === c && w.word[i].state === WordleCharacterState.Yellow) !== -1;
    }

    private isGreenLetterInvalidForPosition(i: number, c: string): boolean {
        return this.board.data.findIndex(w => w.word[i].character === c && w.word[i].state === WordleCharacterState.Black) !== -1;
    }

    private isCharacterValid(character: string, i: number): boolean {
        return (this.isForGreenLetter(i) && this.isProperGreenLetter(i, character))
            || (!this.isForGreenLetter(i) && !this.isYellowLetterInvalidForPosition(i, character)
                && !this.isGreenLetterInvalidForPosition(i, character) && !this.board.invalidLetters.includes(character));
    }

    public onPushCharacter(character: string): boolean {
        if (!/^[a-zA-Z]+$/.test(character))
            throw new Error("Character passed is not alphabetical.");

        if (!this.guidedMode || this.isCharacterValid(character, this.board.currentCharacterIndex)) {
            this.board.pushCharacter(character);
            return true;
        }
        return false;
    }

    public onPopCharacter(): boolean {
        return this.board.popCharacter() !== ' ';
    }

    public onPushWord(): boolean {
        if (!this.board.currentWord.isFull()) {
            this._message = "Word is not full";
            return false;
        }

        if (!this._list || this._list.set.has(this.board.currentWord.join())) {
            this.board.pushAndColorWord();
            this.changeGameState();
            return true;
        }

        this._message = `Word \"${this.board.currentWord.join()}\" does not exist.`;
        return false;
    }

    public giveUp(): void {
        this._gaveUp = true;
        this.changeGameState();
    }
}