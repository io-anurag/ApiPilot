// AP-034 accepted fixture: forbidden names defined, never read (research R3 rule 3).
import http from "k6/http";

class Client {
  constructor(base) {
    this.base = base;
  }
  get(path) {
    return http.get(this.base + path);
  }
}

const shapes = { prototype: "a key, not a prototype", constructor: "also a key", kind: "shape" };

export default function () {
  const client = new Client(__ENV.BASE_URL);
  client.get("/health");
  http.get(`${__ENV.BASE_URL}/${shapes.kind}`);
}
