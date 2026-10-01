import http from "k6/http";
const f = function () {};
const { constructor: c } = f;
export default function () { http.get(`${__ENV.BASE_URL}/`); }
