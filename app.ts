//
//  app.ts ~ RL
//
//  WebRTC signaling server
//

import { WebSocketServer, WebSocket } from "ws"; 
import crypto from "crypto";

function generateSessionId(): string {
    const arr = crypto.randomBytes(5);
    let res = "", curr = 0;
    for (let i = 0; i < arr.length; i++) {
        curr += arr[i];
        const charIndex = curr % 52;
        curr = Math.floor(curr / 52); 
        res += "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"[charIndex];
    }
    return res;
}

const server = new WebSocketServer({ port: 25566 });
const sessions = new Map<string, { users: Array<{ socket: WebSocket, completed: boolean }>, timestamp: number }>();
const sessionLengthMs = 300000; // five minutes in milliseconds, this is how long a session can last

server.addListener("connection", (client) => {
    const clientName = client.url; // this is usually undefined, TO DO
    let sessionId = "";

    console.log(`Client (${clientName}) connected.`);
    client.addEventListener("message", (msg) => {
        try {
            const args = msg.data.toString().split('\n');
            switch (args[0]) {
                case "RequestSessionId": {
                    const id = generateSessionId();
                    console.log(`Client (${clientName}) requested session ID: ${id}.`);
                    client.send(id);
                    sessions.set(id, { users: new Array<{ socket: WebSocket, completed: boolean }>(), timestamp: Date.now() });
                    break;
                }
                case "JoinSession": {
                    if (sessionId !== "" && sessions.has(sessionId)) {
                        const arr = sessions.get(sessionId)!.users;
                        const i = arr.findIndex(a => a.socket === client);
                        if (i !== -1)
                            sessions.get(sessionId)!.users = arr.splice(i, 1);
                        console.log(`Client (${clientName}) already in session: ${sessionId}, removing...`);
                    }
                    const session = sessions.get(args[1])!;
                    if (session.users.length >= 2) {
                        console.log(`Client (${clientName}) tried to join session: ${sessionId}, which already has two users!`);
                        break;
                    }
                    for (let i = 0; i < session.users.length; i++)
                        session.users[i].socket.send(`ClientJoin`); // TO DO: use clientName as a parameter
                    session.users.push({ socket: client, completed: false });
                    sessionId = args[1];
                    console.log(`Client (${clientName}) joined session: ${sessionId}.`);
                    break;
                }

                // If there truly needs to be more than two users per signaling session (unlikely as p2p connections between multiple clients isn't a great
                // idea anyway) there needs to be a client name given to the user along with the session ID. Otherwise, who do these messages belong to? *TO DO*

                case "IceCandidate":
                case "Description": {
                    sessions.get(sessionId)!.users.filter(v => v.socket !== client).forEach(v => v.socket.send(msg.data.toString()));
                    break;
                }
                case "Complete": {
                    const session = sessions.get(sessionId)!;
                    const userIndex = session.users.findIndex(v => v.socket === client);
                    session.users.forEach((v, i) => { if (i !== userIndex) v.socket.send(msg.data.toString()); });
                    session.users[userIndex].completed = true;
                    if (session.users.findIndex(v => !v.completed) === -1)
                        session.users.forEach(v => v.socket.close());
                }
            }
        }
        catch (error) {
            console.log(`Message parse error from client (${clientName}), error (${error}).`);
        }
    });
    client.addEventListener("close", ev => {
        const session = sessions.get(sessionId)!;
        console.log(`Client (${clientName}) left session: ${sessionId}.`);
        session.users = session.users.filter(v => v.socket !== client);
        if (session.users.length <= 0) {
            sessions.delete(sessionId);
            console.log(`Closing session: ${sessionId}.`);
        }
    });
});

setInterval(() => {
    const startTime = Date.now();
    sessions.forEach((i) => {
        if (startTime - i.timestamp >= sessionLengthMs)
            i.users.forEach(j => j.socket.close()); // This takes 30 seconds to actually close?
    });
}, 1000);