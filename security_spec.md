# Security Specification — Physics Smart

## 1. Data Invariants
1. **PII Isolation**: `users/{userId}` contains `email` and personal profile data. Only `isOwner(userId)` or `isAdmin()` may read or write `users/{userId}`. `list` on `users` is strictly limited to `isAdmin()`.
2. **Prevent Self-Assigned Roles**: Non-admin users creating `users/{userId}` MUST set `role == 'student'` and cannot modify `role` on update.
3. **Subcollection Master Gate**: All student subcollections (`progress`, `studyTasks`, `examAttempts`, `tutorSessions`, `graphs`) verify `exists(/databases/$(database)/documents/users/$(userId))`, `userId == request.auth.uid`, and `isOwner(userId) || isAdmin()`.
4. **Public Leaderboard PII Stripping**: `leaderboardPublic/{userId}` contains zero PII (no email/phone) and is writable only by the owner (for their own `uid`) or an admin.
5. **Terminal Exam Locking**: Once an `examAttempts` document reaches `status == 'submitted'`, non-admins cannot mutate its score or answers.
6. **Admin-Only Content Management**: `curricula`, `questions`, `exams`, `labConfigs`, `platformSettings`, and `admins` are writable ONLY by verified administrators (`request.auth.token.email_verified == true` AND either bootstrapped admin email or presence in `admins/{uid}`).
7. **Server Timestamps**: All `createdAt` / `updatedAt` fields must equal `request.time`.

## 2. Adversarial "Dirty Dozen" Payloads (All MUST Return PERMISSION_DENIED)
1. **Role Escalation on Create**: Student creates `/users/{uid}` with `role: "admin"`.
2. **Role Escalation on Update**: Student updates `/users/{uid}` changing `role` to `"admin"`.
3. **Shadow Ghost Field**: Student creates `/users/{uid}` with extra field `isSuperUser: true`.
4. **Cross-User PII Read**: Authenticated Student A attempts `get(/users/{studentB_uid})`.
5. **Users Collection Scrape**: Authenticated Student attempts `list(/users)`.
6. **ID Poisoning**: Client writes `/users/{uid}/studyTasks/` with 300-char ID or invalid characters `../admin`.
7. **Unverified Email Spoofing**: Request with unverified email token attempts write or admin action.
8. **Orphan Subcollection Write**: User creates `/users/{uid}/progress/{lessonId}` without existing `/users/{uid}` parent.
9. **Terminal State Mutation**: Student updates `/users/{uid}/examAttempts/{attemptId}` after `status == 'submitted'` to inflate `score`.
10. **Curriculum Tampering**: Student attempts to `create` or `update` `/curricula/{lessonId}` or `/questions/{questionId}`.
11. **Leaderboard Spoofing**: Student A attempts to write `/leaderboardPublic/{studentB_uid}` or inject `email` into `/leaderboardPublic/{studentA_uid}`.
12. **Client Timestamp Forgery**: Client creates `/users/{uid}/studyTasks/{taskId}` with backdated `createdAt` not equal to `request.time`.
