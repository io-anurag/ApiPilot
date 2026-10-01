import http from "k6/http";
import { setTimeout } from "k6/timers";
setTimeout("doSomething()", 1);
export default function () { http.get(`${__ENV.BASE_URL}/`); }
