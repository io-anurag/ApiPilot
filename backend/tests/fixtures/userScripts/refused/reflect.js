import http from "k6/http";
const k = "a";
const x = make();
const v = Reflect.get(x, k);
export default function () { http.get(`${__ENV.BASE_URL}/`); }
