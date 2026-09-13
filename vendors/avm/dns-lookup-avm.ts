// Normalizer for dns_lookup on a FRITZ!Box.
//
// The baseline normalizer walks a Result.{i} table of per-repetition
// rows. AVM has no such table: NSLookupDiagnostics.Result is one string,
// busybox nslookup's output with a response time appended. Captured from
// the ring:early box, FRITZ!OS 256.08.25:
//
//   Server: 127.0.0.1
//   Name: one.one.one.one
//   Address 1: 1.1.1.1
//   Address 2: 1.0.0.1
//   Address 3: 2606:4700:4700::1111
//   Address 4: 2606:4700:4700::1001
//
//   responsetime: 15004 ms
//
// "Server: 127.0.0.1" is the box's own resolver answering on loopback,
// not the upstream it forwarded to — AVM does not report the upstream,
// so dns_server_ip carries what the operator asked for instead of a
// value that would always read 127.0.0.1.
//
// The output shape is deliberately the baseline's, so the console
// renders an AVM lookup and an NVG lookup identically: one synthetic
// attempt standing for the single answer set AVM returns.

interface Attempt {
  status: string;
  answer_type: string;
  host_name_returned: string;
  ip_addresses: string[];
  dns_server_ip: string;
  response_time_ms: number | null;
}

interface Result {
  capability: string;
  method: string;
  state: string | null;
  hostname: string;
  server: string;
  success_count: number | null;
  addresses: string[];
  attempts: Attempt[];
}

const p = action.params;
const ROOT = "InternetGatewayDevice.X_AVM-DE_DiagnosticTools.NSLookupDiagnostics.";

const raw = p[ROOT + "Result"] ?? "";
const state = p[ROOT + "DiagnosticsState"] ?? null;

const addresses: string[] = [];
let nameReturned = "";
let responseTime: number | null = null;

for (const line of raw.split("\n")) {
  const t = line.trim();
  if (t === "") continue;

  // "Address 1: 1.1.1.1", and the bare "Address: x" some builds emit.
  const addr = /^Address\s*\d*\s*:\s*(\S+)/.exec(t);
  if (addr !== null) {
    const ip = addr[1];
    // A failed lookup still prints the server line; only keep answers.
    if (ip !== "" && addresses.indexOf(ip) < 0) addresses.push(ip);
    continue;
  }

  const nm = /^Name\s*:\s*(\S+)/.exec(t);
  if (nm !== null) {
    nameReturned = nm[1];
    continue;
  }

  const rt = /^responsetime\s*:\s*(\d+)/i.exec(t);
  if (rt !== null) {
    const n = Number(rt[1]);
    if (Number.isFinite(n)) responseTime = n;
  }
}

// Resolved is the honest read of "we got at least one address back".
// AVM has no per-answer status and no SuccessCount, so success_count is
// null rather than a number invented from the address count: the
// baseline's SuccessCount counts repetitions, and one answer set is not
// the same measurement.
const attempts: Attempt[] = [];
if (raw !== "") {
  attempts.push({
    status: addresses.length > 0 ? "Success" : "Error_DNSServerNotResolved",
    answer_type: "",
    host_name_returned: nameReturned,
    ip_addresses: addresses,
    dns_server_ip: action.inputs["server"] ?? "",
    response_time_ms: responseTime,
  });
}

const out: Result = {
  capability: action.capability,
  method: action.profile,
  state: state,
  hostname: action.inputs["hostname"] ?? "",
  server: action.inputs["server"] ?? "",
  success_count: null,
  addresses: addresses,
  attempts: attempts,
};

result(out);
