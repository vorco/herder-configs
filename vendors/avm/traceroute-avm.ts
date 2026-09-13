// Normalizer for traceroute on a FRITZ!Box.
//
// The baseline walks a RouteHops.{i} table. AVM has none:
// TraceRouteDiagnostics.Result is one string, busybox traceroute's
// stdout. Captured from the ring:early box, FRITZ!OS 256.08.25:
//
//   traceroute to one.one.one.one (1.1.1.1), 8 hops max, 38 byte packets
//    1  10.14.15.11 (10.14.15.11)  1.586 ms  3.518 ms  3.711 ms
//    2  *  *  *
//    3  *  *  *
//    4  *  *
//
// Three probes per hop, "*" for a probe that timed out, and a hop that
// answers prints "host (address)" — identical strings when there is no
// reverse DNS, as above. A hop where every probe timed out is KEPT with
// an empty address and no RTTs, because "hop 2 did not answer" is the
// content of a traceroute; dropping silent hops would renumber the route.
//
// The output shape is the baseline's so the console renders both the
// same. error_code is null throughout: AVM reports no per-hop code, and
// 0 would claim success for a hop that timed out.

interface Hop {
  hop: number;
  host: string;
  address: string;
  rtt_ms: number[];
  error_code: number | null;
}

interface Result {
  capability: string;
  method: string;
  state: string | null;
  host: string;
  protocol: string | null;
  response_time_ms: number | null;
  hops: Hop[];
}

const p = action.params;
const ROOT = "InternetGatewayDevice.X_AVM-DE_DiagnosticTools.TraceRouteDiagnostics.";

const raw = p[ROOT + "Result"] ?? "";
const hops: Hop[] = [];

for (const line of raw.split("\n")) {
  const t = line.trim();
  if (t === "") continue;
  // The banner line, not a hop.
  if (t.indexOf("traceroute to") === 0) continue;

  const m = /^(\d+)\s+(.*)$/.exec(t);
  if (m === null) continue;

  const hopNum = Number(m[1]);
  if (!Number.isFinite(hopNum)) continue;
  const rest = m[2];

  let host = "";
  let address = "";
  // "host (1.2.3.4)" — the parenthesised form is the address, and the
  // token before it the name, which busybox repeats when there is no PTR.
  const named = /^(\S+)\s+\(([^)]+)\)/.exec(rest);
  if (named !== null) {
    host = named[1];
    address = named[2];
  }

  const rtt: number[] = [];
  const re = /([0-9]+(?:\.[0-9]+)?)\s*ms/g;
  let r = re.exec(rest);
  while (r !== null) {
    const n = Number(r[1]);
    if (Number.isFinite(n)) rtt.push(n);
    r = re.exec(rest);
  }

  hops.push({
    hop: hopNum,
    host: host,
    address: address,
    rtt_ms: rtt,
    error_code: null,
  });
}

const out: Result = {
  capability: action.capability,
  method: action.profile,
  state: p[ROOT + "DiagnosticsState"] ?? null,
  host: action.inputs["host"] ?? "",
  protocol: p[ROOT + "ProtocolVersion"] ?? null,
  // No ResponseTime leaf on AVM. Null rather than a sum of the hop RTTs,
  // which would be a different quantity wearing the same name.
  response_time_ms: null,
  hops: hops,
};

result(out);
