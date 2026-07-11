package cn.com.rivercloud.util.result;

import lombok.Data;

@Data
public class ApiPageDate {

   private int page_size = 10;

   private int page_num = 1;

   private long total;

   private Object page;

   public ApiPageDate(int page_size, int page_num){
      this.page_size = Math.max(page_size, 1);
      this.page_num = Math.max(page_num, 1);
   }

}
