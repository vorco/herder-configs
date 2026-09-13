// Converge a FRITZ!Box's WAN rate on the subscriber's contracted plan.
//
// The rate is written to X_AVM-DE_{Down,Up}streamShapedRate through
// canonical.operator.avm.wan_rate_{down,up}_kbit. Setting it is the same
// action as typing the speed into the FRITZ!Box GUI: writing ShapedRate
// 300000 -> 290000 moved Layer1*MaxBitRate to 290000 in the same step.
//
// IF YOU ONLY NEED A ONE-SHOT WRITE, YOU DO NOT NEED THIS RULE. An
// external provisioning system can set the rate in a single call:
//
//   PATCH /api/v1/devices/{id}/parameters
//   {"parameters": [
//      {"path": "canonical.operator.avm.wan_rate_down_kbit", "value": "300000"},
//      {"path": "canonical.operator.avm.wan_rate_up_kbit",   "value": "300000"}]}
//
// atomic, audited, and it reaches the box on its next contact. What this
// rule adds is CONVERGENCE: the rate is re-asserted on boot and on every
// periodic pass, so a factory reset, a subscriber changing the speed in
// the GUI, or a plan change pushed while the box was offline all come
// back to the contracted value.
//
// WHY TAGS AND NOT METADATA. devices.metadata is the natural home for
// "what plan is this subscriber on", and PATCH /api/v1/devices/{id}
// validates it against the DeviceField declarations in wan-shaping.yaml.
// But the script SDK has no metadata accessor — device exposes id, oui,
// serialNumber, manufacturer, model, firmware and tags, and ctx exposes
// config; nothing reaches devices.metadata. A metadata key can gate a
// selector (meta:<key>) but its value cannot reach a script, so a rule
// driven by metadata would need one rule per distinct rate pair. Tags
// are readable, so the rate rides a tag. Set both on the same PATCH and
// the metadata stays the record of intent.

var downPrefix = "" + ctx.configGet("downTagPrefix", "plan-down-kbit:");
var upPrefix = "" + ctx.configGet("upTagPrefix", "plan-up-kbit:");
var minKbit = Number(ctx.configGet("minKbit", 1000));
var maxKbit = Number(ctx.configGet("maxKbit", 10000000));

// Returns the kbit/s value carried by the first tag with this prefix,
// or null when there is no such tag or its value is not a number.
function rateFromTag(prefix: string): number | null {
  if (prefix === "") return null;
  var tags = device.tags;
  for (var i = 0; i < tags.length; i++) {
    var t = tags[i];
    if (t.indexOf(prefix) !== 0) continue;
    var raw = t.substring(prefix.length).trim();
    if (raw === "") return null;
    var n = Number(raw);
    if (!isFinite(n) || Math.floor(n) !== n) return null;
    return n;
  }
  return null;
}

var down = rateFromTag(downPrefix);
var up = rateFromTag(upPrefix);

if (down === null && up === null) {
  // No plan on this device. Not an error: a box that has not been sold a
  // plan yet, or one the provisioning system has not reached, should be
  // left exactly as it is rather than shaped to a guess.
  provision.log("AVM WAN shaping: no plan tag on this device, leaving rate untouched");
} else {
  // Range guard. These are kbit/s, and the two ways to get that wrong
  // are both service-affecting: 300 means 0.3 Mbps and 300000000 means
  // 300 Gbps, and either is far likelier to be a unit error than a real
  // plan. A rate outside the band is refused outright rather than
  // clamped — clamping would silently sell the subscriber a different
  // speed from the one the OSS believes it set.
  var bad: string[] = [];
  if (down !== null && (down < minKbit || down > maxKbit)) bad.push("down=" + String(down));
  if (up !== null && (up < minKbit || up > maxKbit)) bad.push("up=" + String(up));

  if (bad.length > 0) {
    provision.warn(
      "AVM WAN shaping: rate outside " + String(minKbit) + "-" + String(maxKbit) +
        " kbit/s (" + bad.join(", ") + "); check the unit, refusing to apply"
    );
    provision.skip("implausible WAN rate");
  } else {
    // Written separately rather than as a pair, so a device carrying
    // only one of the two tags still gets that half applied. The converge
    // layer diffs against reported state, so a rate already correct
    // produces no SPV and no session churn.
    if (down !== null) {
      device.set("canonical.operator.avm.wan_rate_down_kbit", down);
    }
    if (up !== null) {
      device.set("canonical.operator.avm.wan_rate_up_kbit", up);
    }
    provision.log(
      "AVM WAN shaping: down=" + (down === null ? "unset" : String(down)) +
        " up=" + (up === null ? "unset" : String(up)) + " kbit/s"
    );
  }
}
