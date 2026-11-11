/// <reference lib="webworker" />
import { pileWork, type PileAsk } from "./pileWork";

// 轻量's piles in a worker of its own (piles.ts makes it): putting 100,000 roaches in a tree takes half a
// second, and the page goes on meanwhile
const work = pileWork();
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (e: MessageEvent<PileAsk>) => {
  const answer = work(e.data);
  scope.postMessage(answer, answer.type === "piles" ? [answer.data.buffer] : []);
};
