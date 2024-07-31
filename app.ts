//
//  app.ts ~ RL
//
//  WebRTC signaling server
//

import { WebSocketServer } from "ws"; 

const server = new WebSocketServer({ port: 25566 });

server.addListener("connection", (client) => {
    console.log("Connection started with client");
    client.on("message", (msg) => {
        console.log(`Received ${msg}, sending it back.`);
        client.send(msg.toString());
    });
});