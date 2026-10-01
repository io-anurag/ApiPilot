import http from "k6/http";
function summary() { return {}; }
export { summary as handleSummary };
export default function () { http.get(`${__ENV.BASE_URL}/`); }
