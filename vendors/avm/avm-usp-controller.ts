// Add Herder to a FRITZ!Box's USP controller table, over its CWMP
// session. Raw ManagementServer.X_AVM-DE_USPController.* paths; no
// canonical covers them. See usp-controller.yaml for the gates and for
// the survey this was written from.
//
// Idempotence matters more here than in the other AVM scripts, because
// the table is a multi-instance object: a script that blindly adds on
// every boot would stack a new controller per reboot until the box
// refuses. So the instance is FOUND by its EndpointID first, and created
// only when no instance carries ours. ensureObject does exactly that —
// the search expression's terms seed the new instance, so the identity
// is written once whether it matched or created.
//
// Never touch instance 1: on a box enrolled with MyFRITZ that is AVM's
// own controller (EndpointID "pen:872:myfritz-usp") and the ACS may read
// only its EndpointID. Addressing by EndpointID rather than by index is
// what keeps us off it.

var host = ("" + ctx.configGet("controllerHost", "")).trim();
var endpointID = ("" + ctx.configGet("controllerEndpointID", "")).trim();
var username = ("" + ctx.configGet("bootstrapUsername", "")).trim();
var password = ("" + ctx.configGet("bootstrapPassword", "")).trim();

// The "not stood up yet" state. Enrolling a box against an endpoint that
// does not answer leaves it retrying a dead address forever, so refuse to
// write a half-configured controller.
if (host.length === 0 || endpointID.length === 0) {
  provision.log("AVM USP: controllerHost/controllerEndpointID unset, skipping");
} else if (username.length === 0 || password.length === 0) {
  provision.log("AVM USP: bootstrap credential unset, skipping");
} else {
  // Gate 1: the subscriber's GUI consent. Read-only to us. When it is
  // off, AVM removes ACS-added controllers, so writing would be undone
  // silently and we would re-add on every boot.
  var addAllowed = device.getBool(
    "InternetGatewayDevice.ManagementServer.X_AVM-DE_USPControllerAddAllowed"
  );

  if (addAllowed === false) {
    provision.log(
      "AVM USP: X_AVM-DE_USPControllerAddAllowed is off, subscriber has not " +
        "granted ACS controller access; skipping"
    );
  } else if (addAllowed === null) {
    // Unknown rather than false: the path has not been reported yet, or
    // this firmware predates 7.50. Either way, do not guess.
    provision.log(
      "AVM USP: X_AVM-DE_USPControllerAddAllowed not reported, skipping"
    );
  } else {
    var mtp = ("" + ctx.configGet("mtp", "websocket")).trim();
    var port = Number(ctx.configGet("controllerPort", 0));
    var rights = ctx.configGet("accessRights", {}) as Record<string, boolean>;

    // UNVERIFIED: the SDK says ensureObject's param keys are "leaf names
    // relative to the instance", and AccessRights.* is a nested path
    // rather than a bare leaf. It is written this way because it is the
    // shape the box returns, but it has not been run against hardware —
    // the probe that proved the table stopped at AddObject. If the rule
    // logs a rejected key here, set the six rights in a second pass:
    // device.get on the search path with no leaf returns the matched
    // instance's concrete path, which device.set can then address.
    var params: Record<string, string | number | boolean> = {
      Enable: true,
      // Documented "Must always be set to true"; the box defaults it to
      // 1 on a fresh instance and there is no plaintext fallback.
      UseTLS: true,
      Host: host,
      Port: port,
      MTP: mtp,
      Username: username,
      Password: password,
      "AccessRights.WiFi": rights.wifi === true,
      "AccessRights.Internet": rights.internet === true,
      "AccessRights.Mesh": rights.mesh === true,
      "AccessRights.System": rights.system === true,
      "AccessRights.VoIP": rights.voip === true,
      "AccessRights.Controller": rights.controller === true,
    };

    if (mtp === "websocket") {
      params.Path = "" + ctx.configGet("controllerPath", "/usp");
    } else {
      // MQTT. The agent's own endpoint ID goes in the client ID, because
      // that is the field Herder's auth reads the OUI out of on an MQTT
      // connect; os::<OUI>-<SerialNumber> is the TR-369 scheme that
      // carries one. The response topic templates on [[EID]] so each
      // agent gets its own.
      var eid = "os::" + device.oui + "-" + (device.serialNumber || "");
      params.MQTTClientID = eid;
      params.MQTTControllerTopic = "herder/usp/controller";
      params.MQTTResponseTopic = "herder/usp/agent/[[EID]]";
    }

    device.ensureObject(
      'InternetGatewayDevice.ManagementServer.X_AVM-DE_USPController.[EndpointID=="' +
        endpointID +
        '"]',
      params
    );

    provision.log(
      "AVM USP: controller " + endpointID + " ensured on " + host + ":" +
        String(port) + " over " + mtp
    );
  }
}
