ACQUIRE_SCRIPT = """
local t     = redis.call('TIME')
local now   = (tonumber(t[1]) * 1000) + math.floor(tonumber(t[2]) / 1000)
local ttl   = tonumber(ARGV[1]) 
local count = tonumber(ARGV[2])

local res = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
if #res == 0 then
  for i = 0, count - 1 do redis.call('ZADD', KEYS[1], 0, tostring(i)) end
  res = {'0', '0'}
end

local slot  = res[1]
local score = tonumber(res[2])
if score <= now then
  local fence = now + ttl
  local fence_str = string.format('%.0f', fence) 
  redis.call('ZADD', KEYS[1], fence_str, slot)
  return {slot, fence_str}
end
return nil
"""

RELEASE_SCRIPT = """
local cur = redis.call('ZSCORE', KEYS[1], ARGV[1])
if cur and cur == ARGV[2] then
  redis.call('ZADD', KEYS[1], 0, ARGV[1])
end
"""


class NoSlotAvailable(Exception):
    pass
