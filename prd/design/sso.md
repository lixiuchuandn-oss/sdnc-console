一、准备web_id
虚拟机的id   "vm_id": "6943c1bb-7a04-4000-8000-64467e899c39",
我需要做一下运算，vm_id+算法=web_id
后续我要通过web id 进行sso登录。

算法如下
    public static String toObjectId(String uuidStr) {
        UUID uuid = null;
        try {
            uuid = UUID.fromString(uuidStr);
        } catch (Exception e) {
            throw new ServiceException("uuid 格式非法" + e.getMessage());
        }
        byte[] uuidBytes = new byte[16];
        ((ByteBuffer) ByteBuffer.allocate(16).putLong(uuid.getMostSignificantBits()).putLong(uuid.getLeastSignificantBits()).position(0))
                .get(uuidBytes);

        if (uuidBytes[6] != 64 || uuidBytes[7] != 0 || uuidBytes[8] != -128 || uuidBytes[9] != 0)
            throw new IllegalArgumentException(String.format("UUID: %s has not been created from ObjectId", uuid.toString()));

        byte[] objectidBytes = new byte[12];

        System.arraycopy(uuidBytes, 0, objectidBytes, 0, 6);
        System.arraycopy(uuidBytes, 10, objectidBytes, 6, 6);

        return new ObjectId(objectidBytes).toHexString();
    }

二、SSO接口调用
这是我新拿到的CSM接口，可以对网元的web页面进行SSO登录

步骤1
/csm/api/v1.0/authentication/auth
POST请求
{
    "username": "admin",
    "password": "+yNpVuicvsiBzpDpeaIq3g=="
}

步骤2
{
  "method": "GET",
  "path": "/csm/api/v1.0/user/getAdmin",
  "webPort": "8011",
  "headers": {
    "data": "步骤1获取到的data 字段值"
  }
}

步骤3
{
  "method": "POST",
  "path": "/csm/api/v1.0/security/domain/attach/callOnSSO",
  "webPort": "8011",
  "body": {
    "id": "695f6a0ae70890179d5120c7",  //虚拟机id
    "currentLoginWebPort": "8011",  //当前csm的端口号
    "userId": "677e6012d0cc467001064eb1"  //步骤2返回值中的id字段值
  },
  "headers": {
    "token": "步骤3获取到的data 字段值"
  }
}