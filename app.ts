//
//  app.ts ~ RL
//
//  WebRTC signaling server
//

import { WebSocketServer, WebSocket } from "ws"; 
import crypto from "crypto";

interface SignalServerSettings {
    port: number;
    sessionDurationMillis: number;
    sessionIdLength: number;
}

interface SignalServerUser {
    socket: WebSocket;
    sessionId: string;
}

module SignalServer {
    let server: WebSocketServer;
    let sessions: Map<string, { users: Array<{ socket: WebSocket, completed: boolean }>, timestamp: number }>;
    let serverSettings: SignalServerSettings;

    function handleRequestSessionId(client: SignalServerUser): void {
        const arr = crypto.randomBytes(serverSettings.sessionIdLength);
        let res = "", curr = 0;
        for (let i = 0; i < arr.length; i++) {
            curr += arr[i];
            const charIndex = curr % 52;
            curr = Math.floor(curr / 52);
            res += "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"[charIndex];
        }
        console.log(`Client requested session ID: ${res}.`);
        client.socket.send(res);
        sessions.set(res, { users: new Array<{ socket: WebSocket, completed: boolean }>(), timestamp: Date.now() });
    }

    function handleJoinSession(id: string, client: SignalServerUser): void {
        if (client.sessionId !== "" && sessions.has(client.sessionId)) {
            const arr = sessions.get(client.sessionId)!.users;
            const i = arr.findIndex(a => a.socket === client.socket);
            if (i !== -1)
                sessions.get(client.sessionId)!.users = arr.splice(i, 1);
            console.log(`Client already in session: ${client.sessionId}, removing...`);
        }
        const session = sessions.get(id)!;
        if (session.users.length >= 2) {
            console.log(`Client tried to join session: ${client.sessionId}, which already has two users!`);
            return;
        }
        for (let i = 0; i < session.users.length; i++)
            session.users[i].socket.send(`ClientJoin`); // TO DO: use clientName as a parameter
        session.users.push({ socket: client.socket, completed: false });
        client.sessionId = id;
        console.log(`Client joined session: ${client.sessionId}.`);
    }

    function parseMessage(message: any, client: SignalServerUser): void {
        const args = message.toString().split('\n');
        switch (args[0]) {
            case "RequestSessionId":
                handleRequestSessionId(client);
                break;
            case "JoinSession":
                handleJoinSession(args[1], client);
                break;

            // If there truly needs to be more than two users per signaling session (unlikely as p2p connections between multiple clients isn't a great
            // idea anyway) there needs to be a client name given to the user along with the session ID. Otherwise, who do these messages belong to? *TO DO*

            case "IceCandidate":
            case "Description": {
                sessions.get(client.sessionId)!.users.filter(v => v.socket !== client.socket).forEach(v => v.socket.send(message.toString()));
                break;
            }
            case "Complete": {
                const session = sessions.get(client.sessionId)!;
                const userIndex = session.users.findIndex(v => v.socket === client.socket);
                session.users.forEach((v, i) => { if (i !== userIndex) v.socket.send(message.toString()); });
                session.users[userIndex].completed = true;
                if (session.users.findIndex(v => !v.completed) === -1)
                    session.users.forEach(v => v.socket.close());
                break;
            }
        }
    }

    /**
     * Runs the server.
     * @param settings Settings for the server. The function will read all values from SignalServerSetting or provide defaults. It ignores all other attributes.
     */
    export function run(settings: SignalServerSettings | any): void {
        settings.port ??= 25566;
        settings.sessionDurationMillis ??= 1000 * 60 * 5;
        settings.sessionIdLength ??= 5;

        serverSettings = settings;

        server = new WebSocketServer({ port: settings.port });
        sessions = new Map<string, { users: Array<{ socket: WebSocket, completed: boolean }>, timestamp: number }>();

        server.addListener("connection", (client) => {
            const user = { socket: client, sessionId: "" };
            console.log(`Client connected.`);
            client.addEventListener("message", (msg) => {
                try {
                    parseMessage(msg.data, user);
                }
                catch (error) {
                    console.log(`Message parse error from client, error (${error}).`);
                }
            });
            client.addEventListener("close", () => {
                const session = sessions.get(user.sessionId)!;
                console.log(`Client left session: ${user.sessionId}.`);
                session.users = session.users.filter(v => v.socket !== client);
                if (session.users.length <= 0) {
                    sessions.delete(user.sessionId);
                    console.log(`Closing session: ${user.sessionId}.`);
                }
            });
        });
        setInterval(() => {
            const startTime = Date.now();
            sessions.forEach((i) => {
                if (startTime - i.timestamp >= settings.sessionDurationMillis)
                    i.users.forEach(j => j.socket.close()); // This takes 30 seconds to actually close?
            });
        }, 1000);
    }
}

let args: Record<string, any> = {};
try {
    process.argv.slice(2).forEach(pair => {
        const arr = pair.split('=');
        args[arr[0]] = JSON.parse(arr[1]);
    });
}
catch (e) {
    console.log(`Failed to parse arguments (${e}).`);
}
finally {
    SignalServer.run(args);
}