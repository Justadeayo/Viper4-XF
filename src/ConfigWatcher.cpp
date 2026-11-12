#include "ConfigWatcher.h"
#include "log.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <sys/stat.h>
#include <unistd.h>

namespace {

constexpr useconds_t kPollIntervalUs = 1000 * 1000;

bool SameTime(const struct timespec &a, const struct timespec &b) {
    return a.tv_sec == b.tv_sec && a.tv_nsec == b.tv_nsec;
}

// Parses "<param> <type> <value>". Returns false for anything malformed.
bool ParseLine(const char *line, ConfigWatcher::Update *out) {
    char *end = nullptr;
    const long param = strtol(line, &end, 0);
    if (end == line || param <= 0) return false;

    const char *p = end;
    while (*p == ' ' || *p == '\t') ++p;
    const char type = *p;
    if (type != 'b' && type != 'i' && type != 'f') return false;
    ++p;

    while (*p == ' ' || *p == '\t') ++p;
    char *value_end = nullptr;
    const double value = strtod(p, &value_end);
    if (value_end == p) return false;

    out->param = static_cast<int32_t>(param);
    out->type = type;
    out->value = value;
    return true;
}

}  // namespace

ConfigWatcher::ConfigWatcher() = default;

ConfigWatcher::~ConfigWatcher() { Stop(); }

void ConfigWatcher::Start(const char *path) {
    if (running_.exchange(true)) return;
    path_ = path;
    force_reload_.store(true);
    if (pthread_create(&thread_, nullptr, ThreadMain, this) != 0) {
        running_.store(false);
        VIPER_LOGE("ConfigWatcher: failed to start poll thread for %s", path_.c_str());
    }
}

void ConfigWatcher::Stop() {
    if (!running_.exchange(false)) return;
    pthread_join(thread_, nullptr);
}

void ConfigWatcher::ForceReload() { force_reload_.store(true); }

void *ConfigWatcher::ThreadMain(void *self) {
    static_cast<ConfigWatcher *>(self)->Run();
    return nullptr;
}

void ConfigWatcher::Run() {
    while (running_.load()) {
        struct stat st;
        if (stat(path_.c_str(), &st) == 0) {
            const bool changed =
                force_reload_.exchange(false) || !SameTime(st.st_mtim, last_mtime_)
                || st.st_size != last_size_;
            if (changed) {
                last_mtime_ = st.st_mtim;
                last_size_ = st.st_size;

                std::vector<Update> updates;
                if (ReadFile(&updates)) {
                    std::lock_guard<std::mutex> lock(mutex_);
                    // The file always holds the full state, so the newest read
                    // replaces anything not yet applied.
                    queued_.swap(updates);
                    pending_.store(true, std::memory_order_release);
                }
            }
        }
        usleep(kPollIntervalUs);
    }
}

bool ConfigWatcher::ReadFile(std::vector<Update> *out) const {
    FILE *fp = fopen(path_.c_str(), "r");
    if (fp == nullptr) return false;

    char line[256];
    while (fgets(line, sizeof(line), fp) != nullptr) {
        if (line[0] == '#' || line[0] == '\n' || line[0] == '\0') continue;
        Update update;
        if (ParseLine(line, &update)) {
            out->push_back(update);
        }
    }
    fclose(fp);
    return true;
}

bool ConfigWatcher::TakePending(std::vector<Update> *out) {
    std::unique_lock<std::mutex> lock(mutex_, std::try_to_lock);
    if (!lock.owns_lock()) return false;

    out->swap(queued_);
    queued_.clear();
    pending_.store(false, std::memory_order_release);
    return true;
}
