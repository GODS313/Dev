<?php
declare(strict_types=1);

namespace App\Tasks;

use InvalidArgumentException;

/** The single place task modules are registered. Add task #2, #3 here later. */
final class Registry
{
    /** @return array<string, Task> */
    public static function all(): array
    {
        $out = [];
        foreach ([new BuildApkTask()] as $task) {
            $out[$task->key()] = $task;
        }
        return $out;
    }

    public static function get(string $key): Task
    {
        $all = self::all();
        if (!isset($all[$key])) {
            throw new InvalidArgumentException('unknown task: ' . $key);
        }
        return $all[$key];
    }
}
