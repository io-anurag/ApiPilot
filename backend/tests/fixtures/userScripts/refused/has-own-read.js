import http from "k6/http";
const h = Object.prototype.hasOwnProperty;
export default function () { http.get(`${__ENV.BASE_URL}/`); }
