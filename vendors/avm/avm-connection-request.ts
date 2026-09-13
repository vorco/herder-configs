// Enable the FRITZ!Box Connection Request listener and set its source-IP
// policy. Raw ManagementServer.X_AVM-DE_* paths (no canonical exists for
// these vendor controls); device.set stages them as an SPV.
//
// config.ipNetList (comma-separated CIDRs/addresses): when non-empty, it
// is written to the allow-list and the security filter stays on; when
// empty, the filter is turned off so connection requests are accepted
// regardless of source. See connection-request.yaml for why.

var ipNetList = ("" + ctx.configGet("ipNetList", "")).trim();

// Always make sure the CR listener itself is enabled.
device.set(
  "InternetGatewayDevice.ManagementServer.X_AVM-DE_ConnectionRequestEnable",
  true
);

if (ipNetList.length > 0) {
  device.set(
    "InternetGatewayDevice.ManagementServer.X_AVM-DE_ConnectionRequestIPNetList",
    ipNetList
  );
  device.set(
    "InternetGatewayDevice.ManagementServer.X_AVM-DE_ConnectionRequestSecurityEnable",
    true
  );
  provision.log("AVM connection request: allow-list set, security filter on");
} else {
  device.set(
    "InternetGatewayDevice.ManagementServer.X_AVM-DE_ConnectionRequestSecurityEnable",
    false
  );
  provision.log(
    "AVM connection request: no allow-list configured, security filter off"
  );
}
