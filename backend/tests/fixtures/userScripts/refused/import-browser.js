import { browser } from "k6/browser";
export default function () { http.get(`${__ENV.BASE_URL}/`); }
