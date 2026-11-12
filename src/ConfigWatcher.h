#pragma once

#include <atomic>
#include <cstdint>
#include <ctime>
#include <mutex>
#include <pthread.h>
#include <string>
#include <vector>

// Watches a plain-text parameter file and queues the parameters it contains
// for the audio thread to apply. The file is the full state, one line per
// parameter:
//
//     <param> <type> <value>
//
//   param  decimal or 0x-prefixed hex DSP parameter ID (e.g. 0x10160)
//   type   b = bool, i = int, f = float
//   value  0/1 for bool, integer for int, number for float
//
// Lines starting with '#' and malformed lines are ignored.
#ifndef VIPER_CONFIG_PATH
#define VIPER_CONFIG_PATH "/data/local/tmp/viper_re/params.conf"
#endif

class ConfigWatcher {
public:
    struct Update {
        int32_t param = 0;
        char type = 0;
        double value = 0.0;
    };

    ConfigWatcher();
    ~ConfigWatcher();

    ConfigWatcher(const ConfigWatcher &) = delete;
    ConfigWatcher &operator=(const ConfigWatcher &) = delete;

    // Starts the poll thread once. Safe to call repeatedly.
    void Start(const char *path);
    void Stop();

    // Re-read the file on the next poll even if it has not changed.
    // Used after the DSP is reset, which drops all applied parameters.
    void ForceReload();

    // Audio thread: cheap, lock-free check.
    bool HasPending() const { return pending_.load(std::memory_order_acquire); }

    // Audio thread: moves queued updates into `out`. Never blocks; returns
    // false (and leaves the queue intact) if the poll thread holds the lock.
    bool TakePending(std::vector<Update> *out);

private:
    static void *ThreadMain(void *self);
    void Run();
    bool ReadFile(std::vector<Update> *out) const;

    std::string path_;
    pthread_t thread_{};
    std::atomic<bool> running_{false};
    std::atomic<bool> force_reload_{false};
    std::atomic<bool> pending_{false};

    std::mutex mutex_;
    std::vector<Update> queued_;

    struct timespec last_mtime_ {};
    off_t last_size_ = -1;
};
