import http from "k6/http";
const o = globalThis.open;
export default function () { http.get(`${__ENV.BASE_URL}/`); }
