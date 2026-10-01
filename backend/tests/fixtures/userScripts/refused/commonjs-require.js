const k6http = require("k6/http");
export default function () { http.get(`${__ENV.BASE_URL}/`); }
