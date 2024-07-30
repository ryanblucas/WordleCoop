//
//  app.ts ~ RL
//
//  NodeJS backend for Wordle Coop
//

import { WordleGame, WordleWord } from "./wordle.js";
import { WordListManager } from "./wordList.js";

module ConsoleWordle {
    enum Command {
        InfoMenu = 'I',
        ToggleGuidedMode = 'T',
        JoinSession = 'J',
        HostSession = 'H',
        RestartGame = 'R',
        SetWordManual = 'S',
        SetWordNumber = 'A',
    }

    const game = new WordleGame();

    let fs: any;
    let consoleMode: boolean = false;

    function getChar(): string {
        let buffer = Buffer.alloc(1);
        fs.readSync(process.stdin.fd, buffer, 0, 1);
        return buffer.toString();
    }

    function setConsoleMode(mode: boolean) {
        consoleMode = mode;
        process.stdin.setRawMode(mode);
        process.stdout.write(`\u001B[?25${mode ? 'l' : 'h'}`);
    }

    function infoMenu(): void {
        console.log(`Info menu:`);
        console.log(`\tShift + ${Command.InfoMenu} -> Info menu`);
        console.log(`\tShift + ${Command.ToggleGuidedMode} -> Toggle guided mode`);
        console.log(`\tShift + ${Command.RestartGame} -> Restart game`);
        console.log(`\tShift + ${Command.SetWordManual} -> Set word manually`);
        console.log(`\tShift + ${Command.SetWordNumber} -> Set word based on #`);
        //console.log(`\tShift + ${Command.JoinSession} -> Join someone's session`);
        //console.log(`\tShift + ${Command.HostSession} -> Host session`);
        getChar();
    }

    function setWordManual(): void {
        let prevConsoleMode = consoleMode;
        setConsoleMode(false);

        let buffer = Buffer.alloc(16);
        let string = "";
        while (!WordListManager.getWordCoordinates(string)) {
            if (string.length !== 0)
                console.log(`Word \"${string}\" is not in dictionary.`);
            process.stdout.write("Word: ");
            fs.readSync(process.stdin.fd, buffer, 0, 16);
            string = buffer.toString("utf-8").replace(/[^a-z]/gi, '')
        }

        setConsoleMode(prevConsoleMode);
        game.restart(string);
    }

    function setWordNumber(): void {
        let prevConsoleMode = consoleMode;
        setConsoleMode(false);

        let buffer = Buffer.alloc(16);
        process.stdout.write("Word #: ");
        fs.readSync(process.stdin.fd, buffer, 0, 16);
        let string = buffer.toString("utf-8").match(/\d/g)?.join();
        if (string === undefined)
            string = "1";
        let number = parseInt(string);

        setConsoleMode(prevConsoleMode);
        game.restart(WordListManager.getWordOnIndex(number));
    }

    function beginHostSession(): void {

    }

    function beginJoinSession(): void {

    }

    function handleCommands(key: string): void {
        if (key.length !== 1)
            throw new Error("Key provided is not a character.");

        console.clear();
        switch (key) {
            case Command.InfoMenu:
                infoMenu();
                break;

            case Command.SetWordManual:
                setWordManual();
                break;

            case Command.SetWordNumber:
                setWordNumber();
                break;

            case Command.RestartGame:
                game.restart(game.board.targetWord);
                break;

            case Command.ToggleGuidedMode:
                game.guidedMode = !game.guidedMode;
                break;
        }
    }

    function printWord(word: WordleWord): void {
        let colorArray = ["\x1b[37m", "\x1b[37m", "\x1b[33m", "\x1b[32m"];
        for (let i = 0; i < word.word.length; i++)
            process.stdout.write(`${colorArray[word.word[i].state]}${word.word[i].character}\x1b[0m${i + 1 >= word.word.length ? '' : ' '}`);
    }

    function printBoard(): void {
        game.board.data.forEach(value => {
            process.stdout.write("| ");
            printWord(value);
            process.stdout.write(" |\n");
        });
    }

    function printInvalidLetters(): void {
        const spacing = game.board.totalCharacterCount * 2;
        console.log("Invalid letters:");
        for (let i = 0; i < game.board.invalidLetters.length; i++) {
            if (i % spacing === 0)
                process.stdout.write(`${i === 0 ? "" : "\n"}\t`);

            process.stdout.write(`${game.board.invalidLetters[i]}${i + 1 < game.board.invalidLetters.length ? ", " : ""}`);
        }
    }

    export function main(): void {
        fs = require("fs");
        process.stdin.resume();
        setConsoleMode(true);
        console.log(`Shift + ${Command.InfoMenu} for info/help menu. Press any key to continue.`);
        let c = '';
        do {
            game.startQueuedGame();
            if (/^[a-zA-Z]+$/.test(c)) {        // alpha
                if (c.toUpperCase() === c)
                    handleCommands(c);
                else
                    game.onPushCharacter(c);
            }
            else if (c === '\u0008')            // backspace
                game.onPopCharacter();
            else if (c === '\u000d')            // enter
                game.onPushWord();
            else
                continue;

            console.clear();
            if (game.hasMessage())
                console.log(game.popMessage());
            printBoard();
            printInvalidLetters();
        } while (c = getChar());
    }
}

ConsoleWordle.main();