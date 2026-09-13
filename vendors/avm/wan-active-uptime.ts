// canonical.interface.wan.uptime on a FRITZ!Box, whichever WAN
// family the box is currently using.
//
// AVM instantiates ONLY the connection family in use. Proven by
// reconfiguring one 7530 AX between the two:
//
//                              IPoE      PPPoE
//   WANIPConnection instances   1, 2      none
//   WANPPPConnection instances  none      1, 2
//   WANIPConnectionNumberOfEntries   -    0
//   WANPPPConnectionNumberOfEntries  -    2
//
// So a table that hardcodes either family goes dark on half the fleet,
// which is what the instanceAlias this replaces did on every IPoE box.
//
// THE DISCRIMINATOR IS THE NumberOfEntries COUNTER, NOT ConnectionStatus.
// The parameter store keeps rows from before a WAN reconfiguration — a
// box switched from IPoE to PPPoE still has WANIPConnection.1 and .2
// rows reading ConnectionStatus "Connected", hours after those objects
// stopped existing. Matching on status picks one of those ghosts. The
// counter is read from the live tree and cannot be fooled.
//
// Both families also expose duplicate instances (.1 and .2 carry
// byte-identical values, in BOTH modes), so lowest instance wins.
//
// WHEN THIS RUNS: a computed entry is evaluated when one of its declared
// inputs CHANGES, not on every session and not on resolve. A freshly
// deployed computed canonical therefore reads as unresolved
// (raw_missing) until an input moves, which on a stable WAN can be a
// while — Uptime ticking is usually what triggers it first. That is not
// a broken mapping, and canonical-resolve's updated_at is the timestamp
// of the last computation rather than of the last session.
//
// One script, one output: canonical.interface.wan.ip_address has its own
// file because a computed entry writes exactly the path it declares.

// The computed-mapping surface (device.read/write, mapping.warn) is not
// declared in types/sdk.d.ts, which carries only the provisioning and
// enrichment globals. Casting rather than redeclaring `device`, which
// would collide with the SDK's own declaration.
type WanInstances = Record<string, Record<string, string>>;
declare const mapping: { warn(msg: string): void; error(msg: string): void };
var dev = device as unknown as {
  read(path: string): WanInstances | string | null;
};
var out = device as unknown as { write(path: string, value: string): void };

var BASE = "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.";
var LEAF = "Uptime";
var OUTPUT = "canonical.interface.wan.uptime";

function count(path: string): number {
  var v = dev.read(path);
  if (typeof v !== "string" || v === "") return -1;
  var n = Number(v);
  return isFinite(n) ? n : -1;
}

// Lowest instance carrying a non-empty leaf. Sorted numerically: object
// key order is insertion order for integer-like keys in practice, but
// "which instance is lowest" is not something to leave to that.
function pick(instances: WanInstances | string | null): string | null {
  if (instances === null || typeof instances === "string") return null;
  var keys: number[] = [];
  for (var k in instances) {
    var n = Number(k);
    if (isFinite(n)) keys.push(n);
  }
  keys.sort(function (a, b) { return a - b; });
  for (var i = 0; i < keys.length; i++) {
    var inst = instances["" + keys[i]];
    if (!inst) continue;
    var val = inst[LEAF];
    if (val !== undefined && val !== "") return val;
  }
  return null;
}

var pppCount = count(BASE + "WANPPPConnectionNumberOfEntries");
var ipCount = count(BASE + "WANIPConnectionNumberOfEntries");

// -1 means the counter was never reported. Fall back to whichever
// wildcard actually returns instances rather than giving up: a firmware
// that omits the counter still instantiates one family.
var order: string[];
if (pppCount > 0) order = ["WANPPPConnection", "WANIPConnection"];
else if (ipCount > 0) order = ["WANIPConnection", "WANPPPConnection"];
else order = ["WANPPPConnection", "WANIPConnection"];

var written = false;
for (var i = 0; i < order.length; i++) {
  var family = order[i];
  if (family === "WANPPPConnection" && pppCount === 0) continue;
  if (family === "WANIPConnection" && ipCount === 0) continue;
  var found = pick(dev.read(BASE + family + ".*"));
  if (found !== null) {
    out.write(OUTPUT, found);
    written = true;
    break;
  }
}

if (!written) {
  mapping.warn(
    "no active WAN connection found (ppp=" + String(pppCount) +
      ", ip=" + String(ipCount) + ")"
  );
}
