# Field inventory: Epic sandbox, first successful pull

Run: `epic_raw/20261113-122219` (2026-11-13). Sandbox test patient Camila Lopez (`fhircamila`).
This is Epic's synthetic test data, not real records. It shows the *shape* of Epic's data, but the sample is very small.

## What came back

| Resource | Count | Notes |
|---|---|---|
| Observation (laboratory) | **2** | HbA1c (numeric), pharmacogenomic "Genotype:" (text) |
| Observation (vital-signs) | 251 | Pulse 98, BP 92, Weight 51, Temperature 7, Height 3 |
| DiagnosticReport | 6 | 3 lab, 1 X-ray, 1 echo, 1 pathology |
| Condition, MedicationRequest, AllergyIntolerance, Immunization, Procedure | 1 each | |
| Encounter | 5 | |

Granted scopes now include every `patient/*.read` we asked for, plus about 20 more. The 403 earlier in the day was propagation delay.

## Lab Observation: answers to the HANDOFF §6 checklist

| Question | Answer from the data |
|---|---|
| LOINC always present? | **No.** HbA1c has LOINC `4548-4` plus Epic's internal component ID (`urn:oid:…7.2.768282`). The genotype result has **only** the Epic ID. → Fall back to the Epic component ID, and map it in `concepts`. |
| Draw time vs result time? | **Both, to the minute, in UTC (`Z`).** `effectiveDateTime` = collection (14:22:00); `issued` = result released (14:22:41). → `collected_at` = effectiveDateTime; also keep `issued`. |
| valueQuantity unit/UCUM? | **Missing.** HbA1c is `{"value": 5.1}` with no `unit` and no `code`. Vitals do carry UCUM (`Cel`, `/min`, `cm`, `kg`). → The unit can be empty; infer it from LOINC when missing and flag it as inferred. |
| Text results? | `valueString` ("Genotype Value"). → Store them in a text column; `value` stays numeric. |
| Comparators (`<`, `>`)? | **None in this sample.** Still unknown; FHIR puts them in `valueQuantity.comparator`. |
| referenceRange? | **None in either result.** Still unknown for real labs. |
| interpretation (H/L)? | Only `text: "(NONE)"` on the genotype result; no coded H/L. |
| Panel link | `DiagnosticReport.result[]` → Observation (display "Component (1): HEMOGLOBIN A1C, POC"). The Observation's `basedOn` → ServiceRequest gives the order name ("HEMOGLOBIN A1C", "PHARMACOGENOMICS PANEL"). |
| Report codes | LOINC + CPT + SNOMED on HbA1c; the pharmacogenomic panel has only an internal code (`LAB10052`, mislabeled with the CPT system). |
| Specimen / performer | The Observation has a `specimen` reference (a separate resource we could fetch; `Specimen.read` is granted). Report `performer` holds roles only ("Physician", "Attending"), not a lab name. |
| Encounter | Every result links to an Encounter (visit). |
| Notes | `note[].text` exists ("Test Comment"). |

## Other findings

- **Outside records are blocked for our app.** Both the lab search and the report search return an OperationOutcome:
  *"Client not authorized for Observation - Outside Record Results"* (same for DiagnosticReport).
  Results that came from other hospitals (Care Everywhere) would be **silently missing**. This could matter at MD Anderson. → Check whether fhir.epic.com has a separate API entry for outside-record results. **Not verified yet.**
- "SmartData Elements" are suppressed for the *user*. That's probably not relevant to labs.
- Imaging, echo and pathology reports carry `presentedForm` (HTML report text). Those belong to the later `files`/reports work.
- Blood pressure is one Observation with **components** (systolic/diastolic), not two rows. → One measurement row per component.
- The script saves each response unchanged, as planned; OperationOutcome warnings are inside the bundles.

## What this means for the design (to discuss, nothing built)

1. `measurements` needs: `code_system` + `code` (LOINC *or* the Epic ID), `value_num`, `value_text`, `comparator`, `unit` + `unit_inferred`, `collected_at`, `issued_at`, `ref_low`/`ref_high`/`ref_text`, `interpretation`, `report_id`, `order_name`, `encounter_id`, `specimen_id`, `status`, `note`.
2. The sandbox has far too few labs to settle units, reference ranges and comparators. Options: try `fhirderrick`, or wait for real MD Anderson data (production).
3. Save the OperationOutcome warnings from every pull to `sync_log`, so missing data is visible rather than silent.
