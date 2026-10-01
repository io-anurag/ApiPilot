import { WebSocket } from "k6/websockets";
export default function () { http.get(`${__ENV.BASE_URL}/`); }
