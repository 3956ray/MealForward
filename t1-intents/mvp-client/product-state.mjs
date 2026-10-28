export function productRoute(hash = "") {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const id = params.get("businessId");
  const role = params.get("role");
  return { businessId: /^[1-9][0-9]{0,18}$/.test(id || "") ? id : "1", role: ["donor", "issuer", "owner", "records"].includes(role) ? role : "home" };
}
export function scopedPath(businessId, path) {
  if (!/^[1-9][0-9]{0,18}$/.test(businessId)) throw Error("BUSINESS_INVALID");
  if (/^\/(?:(?:status|me)$|auth\/|identity\/)/.test(path)) return path;
  return "/businesses/" + businessId + path;
}
export function captureProductInvite(view) {
  const params = new URLSearchParams(view.location.hash.slice(1));
  const id = params.get("businessId");
  const token = params.get("token") || "";
  // Preserve only the nonsecret business id so a refresh can recover its cookie.
  const valid = /^[1-9][0-9]{0,18}$/.test(id || "");
  view.history.replaceState(null, "", view.location.pathname + (valid ? "#businessId=" + id : ""));
  return { businessId: valid ? id : null, token: valid ? token : "" };
}
