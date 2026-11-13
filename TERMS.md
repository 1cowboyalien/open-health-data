# Terms of Use – Open Health Data

**Last updated: November 13, 2026**

## What this software does

Open Health Data is open-source software that a patient runs on their own computer to download their own medical records from their health system's patient portal, organize them, and optionally publish them.

## Patient authorization

- The patient signs in through their health system's own patient portal (for example, Epic MyChart) and approves access. The software never sees or stores the patient's portal password.
- Access is **read-only**. The software never creates, changes or deletes anything in the medical record.
- The patient can revoke access at any time from their patient portal.

## Where data goes

- Downloaded records are saved only on the patient's own computer.
- Nothing is sent to the developers of this software or to any third party.
- Access tokens are stored in the computer's secure keychain and are never published.
- The patient alone decides whether to publish any of their data. Before publishing, identifiers such as dates of birth, addresses, medical record numbers and insurance IDs are removed.

## Your responsibilities

- Only use this software to access records you are authorized to access: your own, or those of someone who has given you proxy access.
- You are responsible for the data you choose to download and publish.

## No medical advice

This software is not a medical device and does not provide medical advice. Lab results, charts and analyses produced by this project are for informational and research purposes only. Always consult a qualified healthcare professional about medical decisions.

## No warranty

This software is provided "as is", without warranty of any kind, as described in the project's MIT License.

## Contact

Questions or issues: https://github.com/1cowboyalien/open-health-data/issues
