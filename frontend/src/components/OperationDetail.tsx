import type { ApiOperation } from "@apipilot/shared-domain";

export function OperationDetail({ operation }: { operation: ApiOperation }) {
  return (
    <article data-testid="operation-detail">
      <h3>
        {operation.method} {operation.path}
      </h3>
      <section>
        <h4>Parameters</h4>
        {operation.parameters.length === 0 ? (
          <p>None</p>
        ) : (
          <ul>
            {operation.parameters.map((parameter) => (
              <li key={`${parameter.location}-${parameter.name}`}>
                {parameter.name} ({parameter.location}){parameter.required ? " (required)" : ""}
              </li>
            ))}
          </ul>
        )}
      </section>
      {operation.requestBody && (
        <section>
          <h4>Request Body{operation.requestBody.required ? " (required)" : ""}</h4>
          <ul>
            {Object.keys(operation.requestBody.contentTypes).map((contentType) => (
              <li key={contentType}>{contentType}</li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h4>Responses</h4>
        <ul>
          {operation.responses.map((response) => (
            <li key={response.statusCode}>
              {response.statusCode} - {response.description}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h4>Security</h4>
        {operation.security.length === 0 ? (
          <p>No security requirement</p>
        ) : (
          <ul>
            {operation.security.map((requirement, i) => (
              <li key={i}>{requirement.schemes.map((s) => s.name).join(" AND ")}</li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
