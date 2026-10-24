// [S] Text-mode caller used by `npm run sim:call` and by the Convex end-to-end test.
// Speaks the HTTP contract exactly like voice/ does; `fetchPath` hides whether it is real HTTP or convex-test.
import {
  CONTRACT_VERSION,
  SessionEndResponse,
  SessionStartResponse,
  TurnResponse,
  type ReplyKind,
} from "../../src/contracts";

export type ConversationTurn = {
  utterance: string;
  expectKind?: ReplyKind;
  expectReplyIncludes?: string;
  expectUnanswered?: boolean;
  expectSubscription?: boolean;
  expectEndCall?: boolean;
};

export type Conversation = {
  name: string;
  description?: string;
  session: { direction: "inbound" | "outbound"; callerPhone?: string; languageHint?: string; notificationId?: string };
  turns: ConversationTurn[];
};

export type FetchPath = (path: string, init: RequestInit) => Promise<Response>;

export type TurnResult = { turn: ConversationTurn; response: TurnResponse; failures: string[]; elapsedMs: number };

export type SimResult = { greeting: SessionStartResponse; turns: TurnResult[]; end: SessionEndResponse; failures: string[] };

async function post<T>(fetchPath: FetchPath, secret: string, path: string, body: unknown, parse: (x: unknown) => T): Promise<T> {
  const res = await fetchPath(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${text}`);
  return parse(JSON.parse(text));
}

export function checkTurn(turn: ConversationTurn, r: TurnResponse): string[] {
  const failures: string[] = [];
  if (turn.expectKind && r.kind !== turn.expectKind) failures.push(`expected kind ${turn.expectKind}, got ${r.kind}`);
  if (turn.expectReplyIncludes && !r.reply.toLowerCase().includes(turn.expectReplyIncludes.toLowerCase())) {
    failures.push(`expected reply to include "${turn.expectReplyIncludes}"`);
  }
  if (turn.expectUnanswered && !r.unansweredQuestionId) failures.push("expected an unansweredQuestionId");
  if (turn.expectSubscription && !r.subscriptionId) failures.push("expected a subscriptionId");
  if (turn.expectEndCall !== undefined && r.endCall !== turn.expectEndCall) failures.push(`expected endCall ${turn.expectEndCall}`);
  if (r.kind === "answer" && r.citations.length === 0) failures.push("answer without citations");
  return failures;
}

export async function runConversation(opts: {
  fetchPath: FetchPath;
  secret: string;
  conversation: Conversation;
  providerCallId: string;
  now?: () => number;
  onTurn?: (result: TurnResult) => void;
}): Promise<SimResult> {
  const now = opts.now ?? Date.now;
  const { session } = opts.conversation;
  const greeting = await post(opts.fetchPath, opts.secret, "/voice/session/start", {
    contractVersion: CONTRACT_VERSION,
    provider: "cartesia",
    providerCallId: opts.providerCallId,
    direction: session.direction,
    callerPhone: session.callerPhone,
    languageHint: session.languageHint,
    notificationId: session.notificationId,
    startedAt: now(),
  }, SessionStartResponse.parse);

  const turns: TurnResult[] = [];
  for (const [turnIndex, turn] of opts.conversation.turns.entries()) {
    const t0 = Date.now();
    const response = await post(opts.fetchPath, opts.secret, "/voice/turn", {
      contractVersion: CONTRACT_VERSION,
      sessionId: greeting.sessionId,
      turnIndex,
      utterance: turn.utterance,
      language: greeting.language,
      receivedAt: now(),
    }, TurnResponse.parse);
    const result = { turn, response, failures: checkTurn(turn, response), elapsedMs: Date.now() - t0 };
    turns.push(result);
    opts.onTurn?.(result);
    if (response.endCall) break;
  }

  const end = await post(opts.fetchPath, opts.secret, "/voice/session/end", {
    contractVersion: CONTRACT_VERSION,
    sessionId: greeting.sessionId,
    endedAt: now(),
    reason: turns.at(-1)?.response.endCall ? "agent_end" : "caller_hangup",
  }, SessionEndResponse.parse);

  return { greeting, turns, end, failures: turns.flatMap((t, i) => t.failures.map((f) => `turn ${i}: ${f}`)) };
}
