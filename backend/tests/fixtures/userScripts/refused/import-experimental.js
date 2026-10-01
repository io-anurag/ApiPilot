import fs from "k6/experimental/fs";
export default function () { http.get(`${__ENV.BASE_URL}/`); }
