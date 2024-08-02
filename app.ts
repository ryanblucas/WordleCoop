//
//  app.ts ~ RL
//
//  WebRTC signaling server
//

import { WebSocketServer, WebSocket } from "ws"; 
import crypto from "crypto";

function generateSessionId(): string {
    const arr = crypto.randomBytes(7);
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
const sessions = new Map<string, { users: Array<WebSocket>, timestamp: number }>();
const sessionLengthMs = 300000; // five minutes in milliseconds, this is how long a session can last
// TO DO: implement ^^

server.addListener("connection", (client) => {
    const clientName = client.url; // this is usually undefined, TO DO
    let sessionId = "";

    console.log(`Client (${clientName}) connected.`);
    client.addEventListener("message", (msg) => {
        try {
            const args = msg.data.toString().split('\n');
            switch (args[0]) {
                case "RequestSessionId":
                    const id = generateSessionId();
                    console.log(`Client (${clientName}) requested session ID: ${id}.`);
                    client.send(id);
                    sessions.set(id, { users: new Array<WebSocket>(), timestamp: Date.now() });
                    break;
                case "JoinSession":
                    if (sessionId !== "" && sessions.has(sessionId)) {
                        const arr = sessions.get(sessionId)!.users;
                        const i = arr.findIndex(a => a === client);
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
                        session.users[i].send(`ClientJoin`); // TO DO: use clientName as a parameter
                    session.users.push(client);
                    sessionId = args[1];
                    console.log(`Client (${clientName}) joined session: ${sessionId}.`);
                    break;
                case "IceCandidate":
                case "Description":
                    sessions.get(sessionId)!.users.forEach(v => {
                        if (v !== client) {
                            v.send(msg.data.toString());
                            console.log(`Sending ${msg.data.toString()} to client (${v.url}) from client (${clientName}).`);
                        }
                    });
                    break;
                case "Complete":

                    break;
            }
        }
        catch (error) {
            console.log(`Message parse error from client (${clientName}), error (${error}).`);
        }
    });
});