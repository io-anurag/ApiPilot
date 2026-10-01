import http from "k6/http";
const k = "a";
const o = make();
const { [k]: v } = o;
export default function () { http.get(`${__ENV.BASE_URL}/`); }
