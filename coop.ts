//
//  coop.ts ~ RL
//
//  WebRTC client
//

/**
 * Represents the connection between another client
 */
export class BrowserClient {
    private _connection: RTCPeerConnection;
    private _channel: RTCDataChannel;
    private _sessionId: string;

    private static readonly officialSignalServerAddr = "ws://localhost:25566";
    private static readonly mainDataChannelLabel = "WordleGame";

    public get sessionId(): string {
        return this._sessionId;
    }

    public get ready(): boolean {
        return this._channel.readyState === "open";
    }

    private constructor(connection: RTCPeerConnection, channel: RTCDataChannel, sessionId: string) {
        this._connection = connection;
        this._channel = channel;
        this._sessionId = sessionId;
    }

    /**
     * Polls signaling server with val
     * @param val The string to be sent to the signaling server
     * @returns The response the server sent.
     */
    public static async poll(val: string, signalAddr: string = BrowserClient.officialSignalServerAddr): Promise<string> {
        const ws = new WebSocket(signalAddr);
        await new Promise((e) => { ws.addEventListener("open", e); });
        ws.send(val);
        const result = await new Promise((e) => { ws.addEventListener("message", e); });
        ws.close();
        return await (result as MessageEvent).data.text();
    }

    private static validateSessionId(sessionId: string): boolean {
        for (let i = 0; i < sessionId.length; i++) {
            if ((sessionId[i] < 'A' || sessionId[i] > 'Z') && (sessionId[i] < 'a' && sessionId[i] > 'z'))
                return false;
        }
        return true;
    }

    private static createSignalLoop(connection: RTCPeerConnection, ws: WebSocket, hosting: boolean): void {
        connection.onicecandidate = ev => {
            if (!ev.candidate) {
                ws.send("Complete");
                connection.onicecandidate = null;
            }
            else {
                ws.send(`IceCandidate\n${ev.candidate.sdpMid}\n${ev.candidate.candidate}`);
                console.log(`Sending ICE candidate: ${ev.candidate.candidate}`);
            }
        };
        const descriptionType = hosting ? "answer" : "offer";
        const onDescriptionCreation: (value: RTCSessionDescriptionInit) => any = i => {
            console.log(`Sending description: ${i.sdp}`);
            ws.send("Description\n" + i.sdp);
            connection.setLocalDescription(i);
        };
        ws.onmessage = ev => {
            const args = (ev.data as string).split('\n');
            switch (args[0]) {
                case "IceCandidate":
                    console.log(`Adding ICE candidate: ${args[2]}`);
                    connection.addIceCandidate(new RTCIceCandidate({ sdpMid: args[1], candidate: args[2] }));
                    break;
                case "Description":
                    console.log(`Received description: ${args.slice(1, -1).join("\n")}`);
                    connection.setRemoteDescription({ sdp: args.slice(1, -1).join("\n"), type: descriptionType });
                    if (!hosting)
                        connection.createAnswer().then(onDescriptionCreation);
                    break;
            }
            if (args[0] === "ClientJoin" && hosting)
                connection.createOffer().then(onDescriptionCreation);
        };
    }

    /**
     * Creates a BrowserClient for hosting.
     * @returns The client, with the code property filled out.
     */
    public static async host(signalAddr: string = BrowserClient.officialSignalServerAddr): Promise<BrowserClient> {
        const ws = new WebSocket(signalAddr);
        await new Promise((e) => { ws.addEventListener("open", e); });

        ws.send("RequestSessionId");
        const sessionIdEvent = await new Promise((e) => { ws.addEventListener("message", e); });
        const sessionId = (sessionIdEvent as MessageEvent).data as string;
        if (!this.validateSessionId(sessionId))
            throw new Error(`Invalid session ID \"${sessionId}\" given from server, aborting host.`);
        ws.send(`JoinSession\n${sessionId}`);

        const connection = new RTCPeerConnection();
        const channel = connection.createDataChannel(BrowserClient.mainDataChannelLabel)

        this.createSignalLoop(connection, ws, true);

        return new BrowserClient(connection, channel, sessionId);
    }

    /**
     * Creates a BrowserClient for joining an existing session. Both users must share the same signal address.
     * @returns The client, with the code property filled out.
     */
    public static async join(sessionId: string, signalAddr: string = BrowserClient.officialSignalServerAddr): Promise<BrowserClient> {
        if (!this.validateSessionId(sessionId))
            throw new Error(`Invalid session ID \"${sessionId}\", aborting join.`);
        const ws = new WebSocket(signalAddr);
        await new Promise((e) => { ws.addEventListener("open", e); });
        ws.send(`JoinSession\n${sessionId}`);

        const connection = new RTCPeerConnection();
        const channelEvent: Promise<RTCDataChannelEvent> = new Promise(e => connection.addEventListener("datachannel", e));

        this.createSignalLoop(connection, ws, false);

        return new BrowserClient(connection, (await channelEvent).channel, sessionId);
    }
}