package cn.com.rivercloud.util.mongo;

import cn.com.rivercloud.util.exception.ServiceException;
import org.bson.types.ObjectId;

import java.nio.ByteBuffer;
import java.util.UUID;

/**
 * Converts mongodb {@link ObjectId} to java {@link UUID} in both sides using version 4 (randomly generated) UUIDS.
 *
 * @author Lukasz Frankowski (lifeinide.com)
 */
public class MongoUUIDConverter {

    public static String toUUID(String objectIdStr) {
        ObjectId objectId = null;
        try {
            objectId = new ObjectId(objectIdStr);
        } catch (Exception e) {
            e.printStackTrace();
            throw new ServiceException("objectId 格式非法");
        }
        byte[] objectidBytes = objectId.toByteArray();
        byte[] uuidBytes = new byte[16];

        System.arraycopy(objectidBytes, 0, uuidBytes, 0, 6);
        System.arraycopy(objectidBytes, 6, uuidBytes, 10, 6);

        uuidBytes[6] &= 0x0f;  /* clear version        */
        uuidBytes[6] |= 0x40;  /* set to version 4     */
        uuidBytes[8] &= 0x3f;  /* clear variant        */
        uuidBytes[8] |= 0x80;  /* set to IETF variant  */

        ByteBuffer buffer = ByteBuffer.wrap(uuidBytes);

        return new UUID(buffer.getLong(), buffer.getLong()).toString();
    }

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

    public static void main(String[] args) {

//        for (int i=0;i<10000;i++){
//            ObjectId objectId = new ObjectId();
//            String uuid = toUUID(objectId.toHexString());
//            System.out.println(String.format("SRC_ID: %s, UUID: %s, REV_ID: %s", objectId.toHexString(), uuid.toString(),
//                    objectId.toHexString().equals(toObjectId(uuid))));
//        }
//        for (int i=0;i<10000;i++){
//            UUID uuid = UUID.randomUUID();
//            String objId = toObjectId(uuid.toString());
//            System.out.println(String.format("SRC_ID: %s, ObjectId: %s, REV_ID: %s", uuid.toString(), objId,
//                    uuid.equals(toUUID(objId))));
//        }
//        System.out.println(toUUID("613ad2804013625e0995e336"));
//        System.out.println(UUID.randomUUID().getMostSignificantBits());
//        System.out.println(toObjectId(UUID.randomUUID().toString()));
        System.out.println(toUUID("639ec65665a5443f0fd020f7"));
    }

}
