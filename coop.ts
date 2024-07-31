//
//  coop.ts ~ RL
//
//  WebRTC client
//

export class BrowserClient {
    public static async poll(val: string): Promise<string> {
        const ws = new WebSocket("ws://localhost:25566");
        await new Promise((e) => { ws.addEventListener("open", e); });
        ws.send(val);
        const result = await new Promise((e) => { ws.addEventListener("message", e); });
        ws.close();
        return await (result as MessageEvent).data.text();
    }
}