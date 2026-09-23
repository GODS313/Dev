<?php
declare(strict_types=1);

namespace App\Tasks;

/**
 * A self-contained automation module. Each task owns its settings, its enable
 * flag and its runs, so new tasks can be added without touching the others.
 */
interface Task
{
    public function key(): string;

    public function label(): string;

    /** Default non-secret settings shown in the panel form. */
    public function defaultSettings(): array;

    /**
     * Field descriptors for the panel form:
     * [key => ['label'=>.., 'type'=>'text|url|textarea|number', 'secret'=>bool, 'help'=>..]]
     */
    public function fields(): array;

    /** The key under which the secret is stored, or null when the task has none. */
    public function secretField(): ?string;

    /**
     * Advances one run by exactly one step and returns the updated run
     * (with 'status' and appended 'log'). Splitting the work into resumable
     * steps lets the worker recover after a restart without repeating side effects.
     */
    public function step(array $settings, ?string $secret, array $run): array;
}
