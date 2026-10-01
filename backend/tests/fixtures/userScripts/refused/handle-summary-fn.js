import http from "k6/http";
export function handleSummary() { return {}; }
export default function () { http.get(`${__ENV.BASE_URL}/`); }
