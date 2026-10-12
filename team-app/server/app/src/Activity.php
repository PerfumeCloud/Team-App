<?php
declare(strict_types=1);

namespace PC;

/** Verlauf: „Wer hat was gemacht“ – erscheint in der Übersicht. */
final class Activity
{
    public static function log(?string $userId, string $type, ?string $entityType, ?string $entityId, string $text): void
    {
        $now = Util::now();
        Db::insert('activity', [
            'id' => Util::uuid(),
            'user_id' => $userId,
            'type' => $type,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'text' => mb_substr($text, 0, 500),
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }
}
