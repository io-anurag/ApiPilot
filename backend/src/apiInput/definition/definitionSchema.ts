/**
 * The ApiPilot API definition format, version 1, as a JSON Schema (draft-07).
 *
 * This constant is identical to `specs/056-har-json-input-support/contracts/api-definition.v1.schema.json`
 * and a test asserts deep equality of the two, so the running service reads no file and the contract
 * cannot drift from the code. The schema is data: nothing in it is fetched or resolved at run time
 * (the `$ref` entries are local `#/definitions/...` pointers inside this one document).
 *
 * Embedded schemas use a closed vocabulary (`schemaObject`); `$ref`, `$schema`, `$id`, `allOf`,
 * `oneOf` and `anyOf` inside them are unknown fields and are rejected.
 */
export const API_DEFINITION_SCHEMA_V1: Readonly<Record<string, unknown>> = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "urn:apipilot:api-definition:v1",
  "title": "ApiPilot API definition, version 1",
  "description": "A small, strictly validated description of an HTTP API. Unknown fields are rejected. Credential values are not part of the format.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "format",
    "version",
    "info",
    "operations"
  ],
  "properties": {
    "format": {
      "const": "apipilot.api-definition"
    },
    "version": {
      "const": 1
    },
    "info": {
      "$ref": "#/definitions/info"
    },
    "baseUrl": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    },
    "authentication": {
      "type": "array",
      "maxItems": 20,
      "items": {
        "$ref": "#/definitions/authScheme"
      }
    },
    "operations": {
      "type": "array",
      "minItems": 1,
      "maxItems": 2000,
      "items": {
        "$ref": "#/definitions/operation"
      }
    },
    "dependencyHints": {
      "type": "array",
      "maxItems": 500,
      "items": {
        "$ref": "#/definitions/dependencyHint"
      }
    }
  },
  "definitions": {
    "info": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "title"
      ],
      "properties": {
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "version": {
          "type": "string",
          "minLength": 1,
          "maxLength": 50
        },
        "description": {
          "type": "string",
          "maxLength": 2000
        }
      }
    },
    "authScheme": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name",
        "type"
      ],
      "properties": {
        "name": {
          "type": "string",
          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
        },
        "type": {
          "enum": [
            "http-bearer",
            "http-basic",
            "api-key",
            "oauth2-client-credentials"
          ]
        },
        "in": {
          "enum": [
            "header",
            "query",
            "cookie"
          ]
        },
        "parameterName": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "tokenUrl": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2048
        },
        "scopes": {
          "type": "array",
          "maxItems": 100,
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          }
        }
      },
      "allOf": [
        {
          "if": {
            "properties": {
              "type": {
                "const": "api-key"
              }
            },
            "required": [
              "type"
            ]
          },
          "then": {
            "required": [
              "in",
              "parameterName"
            ],
            "properties": {
              "in": {},
              "parameterName": {}
            }
          }
        },
        {
          "if": {
            "properties": {
              "type": {
                "const": "oauth2-client-credentials"
              }
            },
            "required": [
              "type"
            ]
          },
          "then": {
            "required": [
              "tokenUrl"
            ],
            "properties": {
              "tokenUrl": {}
            }
          }
        }
      ]
    },
    "schemaObject": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "type": {
          "enum": [
            "string",
            "number",
            "integer",
            "boolean",
            "object",
            "array",
            "null"
          ]
        },
        "required": {
          "type": "array",
          "maxItems": 200,
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          }
        },
        "properties": {
          "type": "object",
          "maxProperties": 200,
          "additionalProperties": {
            "$ref": "#/definitions/schemaObject"
          }
        },
        "items": {
          "$ref": "#/definitions/schemaObject"
        },
        "enum": {
          "type": "array",
          "minItems": 1,
          "maxItems": 200
        },
        "format": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "minimum": {
          "type": "number"
        },
        "maximum": {
          "type": "number"
        },
        "pattern": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        },
        "minLength": {
          "type": "integer",
          "minimum": 0
        },
        "maxLength": {
          "type": "integer",
          "minimum": 0
        },
        "minItems": {
          "type": "integer",
          "minimum": 0
        },
        "maxItems": {
          "type": "integer",
          "minimum": 0
        }
      }
    },
    "example": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "value"
      ],
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "value": {}
      }
    },
    "parameter": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name",
        "in"
      ],
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "in": {
          "enum": [
            "path",
            "query",
            "header",
            "cookie"
          ]
        },
        "required": {
          "type": "boolean"
        },
        "description": {
          "type": "string",
          "maxLength": 2000
        },
        "schema": {
          "$ref": "#/definitions/schemaObject"
        },
        "example": {}
      }
    },
    "requestBody": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "contentType"
      ],
      "properties": {
        "contentType": {
          "type": "string",
          "pattern": "^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+$",
          "maxLength": 200
        },
        "required": {
          "type": "boolean"
        },
        "schema": {
          "$ref": "#/definitions/schemaObject"
        },
        "examples": {
          "type": "array",
          "maxItems": 20,
          "items": {
            "$ref": "#/definitions/example"
          }
        }
      }
    },
    "response": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "status"
      ],
      "properties": {
        "status": {
          "oneOf": [
            {
              "type": "integer",
              "minimum": 100,
              "maximum": 599
            },
            {
              "type": "string",
              "pattern": "^[1-5][0-9][0-9]$"
            }
          ]
        },
        "description": {
          "type": "string",
          "maxLength": 2000
        },
        "contentType": {
          "type": "string",
          "pattern": "^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+$",
          "maxLength": 200
        },
        "schema": {
          "$ref": "#/definitions/schemaObject"
        },
        "examples": {
          "type": "array",
          "maxItems": 20,
          "items": {
            "$ref": "#/definitions/example"
          }
        }
      }
    },
    "operation": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "method",
        "path"
      ],
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[A-Za-z0-9_.-]{1,100}$"
        },
        "method": {
          "enum": [
            "GET",
            "POST",
            "PUT",
            "PATCH",
            "DELETE",
            "HEAD",
            "OPTIONS",
            "TRACE"
          ]
        },
        "path": {
          "type": "string",
          "pattern": "^/[^?#\\s]*$",
          "maxLength": 2000
        },
        "description": {
          "type": "string",
          "maxLength": 2000
        },
        "tags": {
          "type": "array",
          "maxItems": 50,
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          }
        },
        "parameters": {
          "type": "array",
          "maxItems": 100,
          "items": {
            "$ref": "#/definitions/parameter"
          }
        },
        "requestBody": {
          "$ref": "#/definitions/requestBody"
        },
        "responses": {
          "type": "array",
          "maxItems": 50,
          "items": {
            "$ref": "#/definitions/response"
          }
        },
        "security": {
          "type": "array",
          "maxItems": 20,
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          }
        }
      }
    },
    "dependencyHint": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "producer",
        "consumer"
      ],
      "properties": {
        "producer": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "operation",
            "field"
          ],
          "properties": {
            "operation": {
              "type": "string",
              "minLength": 1,
              "maxLength": 2100
            },
            "field": {
              "type": "string",
              "minLength": 1,
              "maxLength": 500
            }
          }
        },
        "consumer": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "operation",
            "location",
            "field"
          ],
          "properties": {
            "operation": {
              "type": "string",
              "minLength": 1,
              "maxLength": 2100
            },
            "location": {
              "enum": [
                "path",
                "query",
                "header",
                "body"
              ]
            },
            "field": {
              "type": "string",
              "minLength": 1,
              "maxLength": 500
            }
          }
        },
        "note": {
          "type": "string",
          "maxLength": 500
        }
      }
    }
  }
};
