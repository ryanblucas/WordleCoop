//
//  coop.ts ~ RL
//
//  WebRTC client
//

export enum CoopState {
    Connecting,
    Connected,
    Closed,
}

/**
 * Represents the connection between another client
 */
export class CoopClient {
    private _connection: RTCPeerConnection;
    private _channel: RTCDataChannel;

    private _callbacks: Map<string, (msg: any, client: CoopClient) => void>;
    private _protocol: Map<string, any>;
    private _protocolFinished: boolean = false;

    private _otherProtocol: Map<string, any>;
    private _otherProtocolFinished: boolean = false;
    private _queuedMessages: Map<string, any>;

    /**
     * Creates a protocol between us and the other client.
     * @param name Name of the protocol. This cannot contain spaces.
     * @param obj A sample object. This is used for verifying types in messages both incoming and outgoing. This cannot be a function, symbol, or undefined.
     * @param callback User-defined callback for when the other client sends this message.
     * @returns This BrowserClient object, for chaining.
     */
    public addTwoWayProtocol(name: string, obj: any, callback: (msg: any, client: CoopClient) => void): CoopClient {
        if (name.includes(' '))
            throw new Error("Protocol name must not contain spaces.");
        if (this._protocolFinished)
            throw new Error("Protocol gathering is completed, yet addTwoWayProtocol was called.");
        if (typeof obj === "function" || typeof obj === "symbol" || typeof obj === "undefined")
            throw new Error("Protocol sample object cannot be a function, symbol, or undefined.");
        this._channel.send(`ProtocolAdd ${name} ${JSON.stringify(obj)}`);
        this._protocol.set(name, obj);
        this._callbacks.set(name, callback);
        console.log(`Adding two-way protocol \"${name}.\"`);
        return this;
    }

    private verifyMessage(name: string, obj: any): void {
        let result = this._protocol.has(name) && typeof obj === typeof this._protocol.get(name);
        if (typeof obj === "object") {
            const entries = Object.entries(obj);
            let matching = 0;
            for (let i = 0; i < entries.length && result; i++) {
                const verifiedEntries = Object.entries(this._protocol.get(name));
                const matchingKey = verifiedEntries.find(v => v[0] === entries[i][0]);
                result = result && !!matchingKey && typeof matchingKey[1] === typeof entries[i][1];
                if (matchingKey)
                    matching++;
            }
            result = result && entries.length === matching;
        }
        if (!result) {
            this._connection.close();
            throw new Error(`Failed to verify message of type \"${name}.\"`);
        }
    }

    /**
     * Finishes protocol and tells the other client we are done.
     */
    public finishProtocol(): void {
        this._protocolFinished = true;
        this._channel.send("ProtocolFinish");
        if (this._otherProtocolFinished)
            this._otherProtocol.forEach((v, k) => this.verifyMessage(k, v));
    }

    /**
     * Sends message to other user. If this user's protocol is unfinished, an error is thrown.
     * If the other user's protocol is unfinished, this message is queued.
     * @param name Name of protocol to use
     * @param obj Object to send, must follow protocol.
     * @returns Will the message be queued?
     */
    public sendMessage(name: string, obj: any): boolean {
        this.verifyMessage(name, obj);
        const willQueue = !this._otherProtocolFinished || !this._protocolFinished;
        if (willQueue)
            this._queuedMessages.set(name, obj);
        else
            this._channel.send(`${name} ${JSON.stringify(obj)}`);
        return willQueue;
    }

    private onMessage(event: MessageEvent) {
        try {
            const args = (event.data as string).split(' ');
            if (args[0] === "ProtocolAdd") {
                if (this._otherProtocolFinished)
                    throw new Error("Protocol already finished, yet other user is sending more protocol messages.");
                const obj = JSON.parse(args.splice(2, args.length).join(' '));
                this._otherProtocol.set(args[1], obj);
                return;
            }
            else if (args[0] === "ProtocolFinish") {
                if (this._otherProtocolFinished)
                    throw new Error("Protocol already finished, yet other user is sending more protocol messages.");
                this._otherProtocolFinished = true;
                if (this._protocolFinished)
                    this._otherProtocol.forEach((v, k) => this.verifyMessage(k, v));
                this._queuedMessages.forEach((v, k) => this.sendMessage(k, v));
                this._queuedMessages.clear();
                return;
            }
            const obj = JSON.parse(args.splice(1, args.length).join(' '));
            this.verifyMessage(args[0], obj);
            this._callbacks.get(args[0])!(obj, this);
        }
        catch (e) {
            console.log(`Other user sent an invalid message: "${event.data}"\nError: "${e}"\nDisconnecting immediately.`);
            this._connection.close();
        }
    }

    private _sessionId: string;

    private static readonly mainDataChannelLabel = "WordleGame";
    private static readonly officialSignalServerAddr = "ws://localhost:25566";

    public get sessionId(): string {
        return this._sessionId;
    }

    public get state(): CoopState {
        if (this._channel.readyState === "open")
            return CoopState.Connected;
        else if (this._channel.readyState === "closed" || this._channel.readyState === "closing")
            return CoopState.Closed;
        return CoopState.Connecting;
    }

    /**
     * Creates a promise to wait for when this connection is ready.
     * If the connection is closed or becomes closed, it will return a rejected promise.
     * @returns A promise with this client as its parameter.
     */
    public whenReady(): Promise<CoopClient> {
        if (this.state === CoopState.Connected)
            return Promise.resolve(this);
        else if (this.state === CoopState.Closed)
            return Promise.reject("Client closed.");
        const res = new Promise<CoopClient>((resolve, reject) => {
            // TO DO: there should be at least two events to listen to, right? One for the channel and connection?
            this._channel.addEventListener("open", _ => resolve(this))
            this._channel.addEventListener("error", _ => reject("Data channel error"));
            this._channel.addEventListener("closing", _ => reject("Data channel closing"));
            this._channel.addEventListener("close", _ => reject("Data channel closed"));
            this._connection.addEventListener("icecandidateerror", _ => reject("ICE error"));
            this._connection.addEventListener("connectionstatechange", e => {
                // Failed and disconnected refer to ICE transports. TO DO: I *think* it can let the connection handle those.
                if (this._connection.connectionState === "closed")
                    reject("Connection closed");
            });
        });
        return res;
    }

    private constructor(connection: RTCPeerConnection, channel: RTCDataChannel, sessionId: string) {
        this._connection = connection;
        this._channel = channel;
        this._sessionId = sessionId;

        this._callbacks = new Map<string, (msg: any, client: CoopClient) => void>();
        this._protocol = new Map<string, any>();
        this._otherProtocol = new Map<string, any>();
        this._queuedMessages = new Map<string, any>();

        this._channel.addEventListener("message", this.onMessage.bind(this));
    }

    /**
     * Polls signaling server with val
     * @param val The string to be sent to the signaling server
     * @returns The response the server sent.
     */
    public static async poll(val: string, signalAddr: string = CoopClient.officialSignalServerAddr): Promise<string> {
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
        let completedCount = 0;
        connection.onicecandidate = ev => {
            if (!ev.candidate) {
                ws.send("Complete");
                connection.onicecandidate = null;
                if (++completedCount >= 2) {
                    ws.close();
                    return;
                }
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
                case "Complete":
                    if (++completedCount >= 2) {
                        ws.close();
                        return;
                    }
                    break;
            }
            if (args[0] === "ClientJoin" && hosting)
                connection.createOffer().then(onDescriptionCreation);
        };
        ws.onclose = _ => {
            if (completedCount < 2) {
                console.log("WebSocket closed mid-signal session.");
                connection.close();
            }
        }
    }

    /**
     * Creates a BrowserClient for hosting.
     * @returns The client, with the code property filled out.
     */
    public static async host(signalAddr: string = CoopClient.officialSignalServerAddr): Promise<CoopClient> {
        const ws = new WebSocket(signalAddr);
        await new Promise((e) => { ws.addEventListener("open", e); });

        ws.send("RequestSessionId");
        const sessionIdEvent = await new Promise((e) => { ws.addEventListener("message", e); });
        const sessionId = (sessionIdEvent as MessageEvent).data as string;
        if (!this.validateSessionId(sessionId))
            throw new Error(`Invalid session ID \"${sessionId}\" given from server, aborting host.`);
        ws.send(`JoinSession\n${sessionId}`);

        const connection = new RTCPeerConnection();
        const channel = connection.createDataChannel(CoopClient.mainDataChannelLabel);

        this.createSignalLoop(connection, ws, true);

        return new CoopClient(connection, channel, sessionId);
    }

    /**
     * Creates a BrowserClient for joining an existing session. Both users must share the same signal address.
     * @returns The client, with the code property filled out.
     */
    public static async join(sessionId: string, signalAddr: string = CoopClient.officialSignalServerAddr): Promise<CoopClient> {
        if (!this.validateSessionId(sessionId))
            throw new Error(`Invalid session ID \"${sessionId}\", aborting join.`);
        const ws = new WebSocket(signalAddr);
        await new Promise((e) => { ws.addEventListener("open", e); });
        ws.send(`JoinSession\n${sessionId}`);

        const connection = new RTCPeerConnection();
        const channelEvent: Promise<RTCDataChannelEvent> = new Promise(e => connection.addEventListener("datachannel", e));

        this.createSignalLoop(connection, ws, false);

        return new CoopClient(connection, (await channelEvent).channel, sessionId);
    }
}