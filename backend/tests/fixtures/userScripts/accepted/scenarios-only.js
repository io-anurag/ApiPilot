// AP-034 accepted fixture: named scenarios and no default function (FR-027).
import http from "k6/http";

export const options = {
  scenarios: {
    browse: { executor: "constant-vus", vus: 1, duration: "5s", exec: "browse" },
    buy: { executor: "per-vu-iterations", vus: 1, iterations: 2, exec: "buy" },
  },
};

export function browse() {
  http.get(`${__ENV.BASE_URL}/products`);
}

export function buy() {
  http.post(`${__ENV.BASE_URL}/orders`, "{}");
}
