# Claude Instructions

## Firebase Map Reset Requirement

After any change that requiment the database schema to change you must tell the user to delete/reset Firebase map data before testing, instead creating scripts to recover old version.

Reason: existing generated map tiles in Firebase may still reference old tile IDs or fields and can cause mismatches with current code/data.

Expected instruction to user:
- Delete or reset the `map` data in Firebase Realtime Database.
- Regenerate map content by loading the game again.


## Redone SPEC and PLAN

On every prompt review PLAN ans SPEC and update it with the new funcionality.

