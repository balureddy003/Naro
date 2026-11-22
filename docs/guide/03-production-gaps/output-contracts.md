# Loose / Unstructured Output

## The gap

The model emits free-form text or weakly typed objects. Downstream systems, auditors, and verifiers cannot reliably consume the result.

## What “closed” looks like

- Every external effect and final result has a schema or predicate.
- Verification rejects malformed output.
- Observations carry structured payloads, not only strings.

## How Naro addresses it

- Schema, predicate, and composite verifiers.
- Tool results and environment observations are structured.
- Completion is not accepted until the verifier passes.

## What remains application-owned

- Defining the schemas that match your domain.
- Deciding which fields are mandatory versus optional.

## Checklist

- [ ] Final completion has a schema or predicate.
- [ ] Every tool that returns data used by later steps has a schema.
- [ ] Verifier is configured and cannot be skipped.
